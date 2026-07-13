'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const {
  FSRSVersion,
  Rating,
  State,
  createEmptyCard,
  fsrs,
  generatorParameters,
} = require('ts-fsrs');

const DAY_MS = 24 * 60 * 60 * 1000;
const FSRS_ALGORITHM = 'fsrs-6';
const FSRS_SCHEMA_VERSION = 6;
const FSRS_PARAMETERS = generatorParameters({
  request_retention: 0.9,
  maximum_interval: 36500,
  enable_fuzz: true,
  enable_short_term: true,
  learning_steps: ['1m', '10m'],
  relearning_steps: ['10m'],
});
const FSRS_SCHEDULER = fsrs(FSRS_PARAMETERS);

function parseJson(value, fallback) {
  if (typeof value !== 'string') return fallback;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function placeholders(length) {
  return Array.from({ length }, () => '?').join(', ');
}

function isoNow() {
  return new Date().toISOString();
}

function normalizeIso(value, fieldName = 'timestamp') {
  const date = value === undefined ? new Date() : new Date(value);
  if (!Number.isFinite(date.getTime())) {
    const error = new Error(`${fieldName} must be a valid date-time`);
    error.code = 'INVALID_DATE';
    throw error;
  }
  return date.toISOString();
}

function mapPrimaryEntry(row) {
  const forms = parseJson(row.group_forms_json, []);
  const groupLabel = row.group_meaning_zh
    ? `${forms.join(', ')}｜${row.group_meaning_zh}`
    : null;

  return {
    entryId: row.entry_id,
    pronunciation: row.pronunciation,
    partsOfSpeech: parseJson(row.parts_of_speech_json, []),
    definitionZh: row.definition_zh,
    relationType: row.relation_type,
    relationTerm: row.relation_term,
    examTag: row.exam_tag,
    difficulty: row.difficulty,
    etymology: row.etymology,
    exampleEn: row.example_en,
    exampleZh: row.example_zh,
    section: row.section,
    unitTitle: row.unit_title_zh,
    groupLabel,
    qualityFlags: parseJson(row.quality_flags_json, []),
  };
}

function mapCard(row) {
  return {
    lexemeId: row.lexeme_id,
    canonicalTerm: row.canonical_term,
    displayHeadword: row.display_headword,
    variants: parseJson(row.variants_json, []),
    entryCount: row.entry_count,
    primary: mapPrimaryEntry(row),
    review: null,
  };
}

function mapProgress(row) {
  if (!row) return null;
  return {
    lexemeId: row.lexeme_id,
    due: row.due_at,
    stability: row.stability,
    difficulty: row.difficulty,
    retrievability: row.retrievability,
    lapses: row.lapses,
    state: row.state,
    reps: row.reps,
    againCount: row.again_count,
    goodCount: row.good_count,
    lastReview: row.last_review_at,
    lastIntervalDays: row.last_interval_days,
    scheduler: {
      algorithm: row.scheduler_algorithm,
      version: row.scheduler_version,
      libraryVersion: FSRSVersion,
      fsrsData: parseJson(row.fsrs_data_json, null),
    },
  };
}

class CatalogStore {
  constructor(databasePath) {
    this.databasePath = path.resolve(databasePath);
    if (!fs.existsSync(this.databasePath)) {
      throw new Error(`Vocabulary database not found: ${this.databasePath}`);
    }

    this.db = new DatabaseSync(this.databasePath, { readOnly: true });
    this.db.exec('PRAGMA query_only = ON; PRAGMA foreign_keys = ON;');
  }

  close() {
    this.db.close();
  }

  health() {
    const schemaVersion = this.db
      .prepare("SELECT value FROM metadata WHERE key = 'schema_version'")
      .get()?.value ?? null;
    const generatedAt = this.db
      .prepare("SELECT value FROM metadata WHERE key = 'generated_at'")
      .get()?.value ?? null;
    const lexemeCount = this.db.prepare('SELECT count(*) AS count FROM lexeme').get().count;
    const rangeCount = this.db
      .prepare('SELECT count(*) AS count FROM range_definition')
      .get().count;

    return { schemaVersion, generatedAt, lexemeCount, rangeCount, readOnly: true };
  }

  listRanges() {
    return this.db
      .prepare(`
        SELECT id, kind, name, parent_id, status, entry_count, unique_term_count
        FROM range_definition
        ORDER BY
          CASE kind
            WHEN 'all' THEN 0
            WHEN 'source' THEN 1
            WHEN 'section' THEN 2
            WHEN 'unit' THEN 3
            WHEN 'group' THEN 4
            ELSE 5
          END,
          id
      `)
      .all()
      .map((row) => ({
        id: row.id,
        kind: row.kind,
        name: row.name,
        parentId: row.parent_id,
        status: row.status,
        entryCount: row.entry_count,
        lexemeCount: row.unique_term_count,
      }));
  }

  findMissingRangeIds(rangeIds) {
    if (rangeIds.length === 0) return [];
    const rows = this.db
      .prepare(`SELECT id FROM range_definition WHERE id IN (${placeholders(rangeIds.length)})`)
      .all(...rangeIds);
    const found = new Set(rows.map((row) => row.id));
    return rangeIds.filter((id) => !found.has(id));
  }

  lexemeIdsForRanges(rangeIds) {
    if (rangeIds.length === 0) return [];
    return this.db
      .prepare(`
        SELECT DISTINCT lexeme_id
        FROM range_lexeme
        WHERE range_id IN (${placeholders(rangeIds.length)})
        ORDER BY lexeme_id
      `)
      .all(...rangeIds)
      .map((row) => row.lexeme_id);
  }

  selectCards(rangeIds, limit) {
    const args = [...rangeIds];
    const where = placeholders(rangeIds.length);
    const total = this.db
      .prepare(`
        SELECT count(DISTINCT lexeme_id) AS count
        FROM range_lexeme
        WHERE range_id IN (${where})
      `)
      .get(...args).count;

    const limitSql = Number.isInteger(limit) ? 'LIMIT ?' : '';
    if (Number.isInteger(limit)) args.push(limit);

    const rows = this.db
      .prepare(`
        WITH selected AS (
          SELECT DISTINCT lexeme_id
          FROM range_lexeme
          WHERE range_id IN (${where})
        )
        SELECT
          l.id AS lexeme_id,
          l.canonical_term,
          l.display_headword,
          l.variants_json,
          l.entry_count,
          e.id AS entry_id,
          e.pronunciation,
          e.parts_of_speech_json,
          e.definition_zh,
          e.relation_type,
          e.relation_term,
          e.exam_tag,
          e.difficulty,
          e.etymology,
          e.example_en,
          e.example_zh,
          e.section,
          e.quality_flags_json,
          u.title_zh AS unit_title_zh,
          g.forms_json AS group_forms_json,
          g.meaning_zh AS group_meaning_zh
        FROM selected s
        JOIN lexeme l ON l.id = s.lexeme_id
        JOIN entry e ON e.id = l.primary_entry_id
        LEFT JOIN unit u ON u.id = e.unit_id
        LEFT JOIN word_group g ON g.id = e.group_id
        ORDER BY e.source_order, l.canonical_term
        ${limitSql}
      `)
      .all(...args);

    return { total, cards: rows.map(mapCard) };
  }

  getLexeme(lexemeId) {
    const lexeme = this.db
      .prepare(`
        SELECT id, canonical_term, display_headword, variants_json,
               primary_entry_id, entry_count, source_ids_json,
               has_multiple_definitions
        FROM lexeme
        WHERE id = ?
      `)
      .get(lexemeId);

    if (!lexeme) return null;

    const entries = this.db
      .prepare(`
        SELECT
          e.id AS entry_id,
          e.headword,
          e.pronunciation,
          e.parts_of_speech_json,
          e.definition_zh,
          e.relation_type,
          e.relation_term,
          e.exam_tag,
          e.difficulty,
          e.etymology,
          e.example_en,
          e.example_zh,
          e.section,
          e.quality_flags_json,
          e.source_id,
          e.source_order,
          e.unit_id,
          e.group_id,
          u.title_zh AS unit_title_zh,
          g.forms_json AS group_forms_json,
          g.meaning_zh AS group_meaning_zh
        FROM entry e
        LEFT JOIN unit u ON u.id = e.unit_id
        LEFT JOIN word_group g ON g.id = e.group_id
        WHERE e.lexeme_id = ?
        ORDER BY e.source_order
      `)
      .all(lexemeId)
      .map((row) => ({
        ...mapPrimaryEntry(row),
        headword: row.headword,
        sourceId: row.source_id,
        sourceOrder: row.source_order,
        unitId: row.unit_id,
        groupId: row.group_id,
      }));

    return {
      lexemeId: lexeme.id,
      canonicalTerm: lexeme.canonical_term,
      displayHeadword: lexeme.display_headword,
      variants: parseJson(lexeme.variants_json, []),
      primaryEntryId: lexeme.primary_entry_id,
      entryCount: lexeme.entry_count,
      sourceIds: parseJson(lexeme.source_ids_json, []),
      hasMultipleDefinitions: Boolean(lexeme.has_multiple_definitions),
      entries,
    };
  }

  getLexemeIdentity(lexemeId) {
    return (
      this.db
        .prepare('SELECT id, display_headword FROM lexeme WHERE id = ?')
        .get(lexemeId) ?? null
    );
  }

  entryBelongsToLexeme(entryId, lexemeId) {
    return Boolean(
      this.db
        .prepare('SELECT 1 AS ok FROM entry WHERE id = ? AND lexeme_id = ?')
        .get(entryId, lexemeId),
    );
  }

  getLexemeBriefs(lexemeIds) {
    if (lexemeIds.length === 0) return new Map();
    const rows = this.db
      .prepare(`
        SELECT l.id, l.display_headword, e.definition_zh
        FROM lexeme l
        JOIN entry e ON e.id = l.primary_entry_id
        WHERE l.id IN (${placeholders(lexemeIds.length)})
      `)
      .all(...lexemeIds);
    return new Map(
      rows.map((row) => [
        row.id,
        { displayHeadword: row.display_headword, definitionZh: row.definition_zh },
      ]),
    );
  }

  getArticleLexemes(lexemeIds = [], words = []) {
    const rows = this.db
      .prepare(`
        SELECT
          l.id AS lexeme_id,
          l.canonical_term,
          l.display_headword,
          l.variants_json,
          e.definition_zh,
          e.parts_of_speech_json,
          e.example_en,
          e.source_order
        FROM lexeme l
        JOIN entry e ON e.id = l.primary_entry_id
        ORDER BY e.source_order, l.canonical_term
      `)
      .all()
      .map((row) => ({
        lexemeId: row.lexeme_id,
        canonicalTerm: row.canonical_term,
        displayHeadword: row.display_headword,
        variants: parseJson(row.variants_json, []),
        definitionZh: row.definition_zh,
        partsOfSpeech: parseJson(row.parts_of_speech_json, []),
        exampleEn: row.example_en,
      }));
    const byId = new Map(rows.map((row) => [row.lexemeId, row]));
    const byTerm = new Map();
    rows.forEach((row) => {
      [row.canonicalTerm, row.displayHeadword, ...row.variants]
        .filter(Boolean)
        .forEach((term) => {
          const key = String(term).trim().toLocaleLowerCase('en-US');
          if (!byTerm.has(key)) byTerm.set(key, row);
        });
    });

    const selected = [];
    const selectedIds = new Set();
    const missingLexemeIds = [];
    const missingWords = [];
    const add = (row) => {
      if (row && !selectedIds.has(row.lexemeId)) {
        selectedIds.add(row.lexemeId);
        selected.push(row);
      }
    };
    lexemeIds.forEach((lexemeId) => {
      const row = byId.get(lexemeId);
      if (row) add(row);
      else missingLexemeIds.push(lexemeId);
    });
    words.forEach((word) => {
      const row = byTerm.get(word.trim().toLocaleLowerCase('en-US'));
      if (row) add(row);
      else missingWords.push(word);
    });

    return { lexemes: selected, missingLexemeIds, missingWords };
  }
}

class ProgressStore {
  constructor(databasePath) {
    this.databasePath = path.resolve(databasePath);
    fs.mkdirSync(path.dirname(this.databasePath), { recursive: true });
    this.db = new DatabaseSync(this.databasePath);
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA synchronous = NORMAL;
      PRAGMA foreign_keys = ON;
      PRAGMA busy_timeout = 5000;

      CREATE TABLE IF NOT EXISTS metadata (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS study_session (
        id TEXT PRIMARY KEY,
        created_at TEXT NOT NULL,
        range_ids_json TEXT NOT NULL,
        item_count INTEGER NOT NULL,
        order_name TEXT NOT NULL CHECK (order_name IN ('source', 'shuffle'))
      );

      CREATE TABLE IF NOT EXISTS study_session_item (
        session_id TEXT NOT NULL,
        position INTEGER NOT NULL,
        lexeme_id TEXT NOT NULL,
        PRIMARY KEY (session_id, position),
        UNIQUE (session_id, lexeme_id),
        FOREIGN KEY (session_id) REFERENCES study_session(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS lexeme_progress (
        lexeme_id TEXT PRIMARY KEY,
        due_at TEXT NOT NULL,
        stability REAL NOT NULL DEFAULT 0,
        difficulty REAL NOT NULL DEFAULT 5,
        retrievability REAL NOT NULL DEFAULT 0,
        lapses INTEGER NOT NULL DEFAULT 0,
        state TEXT NOT NULL DEFAULT 'new'
          CHECK (state IN ('new', 'learning', 'review', 'relearning')),
        reps INTEGER NOT NULL DEFAULT 0,
        again_count INTEGER NOT NULL DEFAULT 0,
        good_count INTEGER NOT NULL DEFAULT 0,
        last_review_at TEXT,
        last_interval_days REAL NOT NULL DEFAULT 0,
        scheduler_algorithm TEXT NOT NULL DEFAULT 'fsrs-6',
        scheduler_version INTEGER NOT NULL DEFAULT 6,
        fsrs_data_json TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS review_event (
        id TEXT PRIMARY KEY,
        lexeme_id TEXT NOT NULL,
        entry_id TEXT,
        session_id TEXT,
        range_ids_json TEXT NOT NULL,
        reviewed_at TEXT NOT NULL,
        rating TEXT NOT NULL CHECK (rating IN ('again', 'good')),
        rating_value INTEGER NOT NULL CHECK (rating_value IN (1, 3)),
        mode TEXT NOT NULL DEFAULT 'flashcard',
        direction TEXT NOT NULL DEFAULT 'front-to-back',
        response_ms INTEGER,
        flipped_before_answer INTEGER NOT NULL DEFAULT 0,
        was_correct INTEGER NOT NULL,
        scheduled_days REAL NOT NULL,
        elapsed_days REAL NOT NULL,
        state_before TEXT NOT NULL,
        state_after TEXT NOT NULL,
        scheduler_algorithm TEXT NOT NULL,
        scheduler_version INTEGER NOT NULL,
        scheduler_before_json TEXT NOT NULL,
        scheduler_after_json TEXT NOT NULL,
        FOREIGN KEY (session_id) REFERENCES study_session(id) ON DELETE SET NULL
      );

      CREATE TABLE IF NOT EXISTS generated_article (
        id TEXT PRIMARY KEY,
        created_at TEXT NOT NULL,
        title TEXT NOT NULL,
        body TEXT NOT NULL,
        translation_zh TEXT,
        used_words_json TEXT NOT NULL,
        questions_json TEXT NOT NULL,
        selected_lexeme_ids_json TEXT NOT NULL,
        provider TEXT NOT NULL,
        model TEXT NOT NULL,
        level TEXT NOT NULL,
        length TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_session_item_lexeme
        ON study_session_item (lexeme_id);
      CREATE INDEX IF NOT EXISTS idx_progress_due
        ON lexeme_progress (due_at);
      CREATE INDEX IF NOT EXISTS idx_review_event_lexeme_time
        ON review_event (lexeme_id, reviewed_at);
      CREATE INDEX IF NOT EXISTS idx_review_event_session
        ON review_event (session_id);
      CREATE INDEX IF NOT EXISTS idx_generated_article_created
        ON generated_article (created_at DESC);

      INSERT INTO metadata (key, value) VALUES ('schema_version', '3')
      ON CONFLICT(key) DO UPDATE SET value = excluded.value;
      INSERT INTO metadata (key, value) VALUES ('scheduler_library', '${FSRSVersion}')
      ON CONFLICT(key) DO UPDATE SET value = excluded.value;
      INSERT INTO metadata (key, value) VALUES ('scheduler_parameters', '${JSON.stringify(FSRS_PARAMETERS)}')
      ON CONFLICT(key) DO UPDATE SET value = excluded.value;
    `);
  }

  close() {
    this.db.close();
  }

  health() {
    const schemaVersion = this.db
      .prepare("SELECT value FROM metadata WHERE key = 'schema_version'")
      .get()?.value ?? null;
    const reviewCount = this.db
      .prepare('SELECT count(*) AS count FROM review_event')
      .get().count;
    return {
      schemaVersion,
      reviewCount,
      writable: true,
      scheduler: {
        algorithm: FSRS_ALGORITHM,
        version: FSRS_SCHEMA_VERSION,
        libraryVersion: FSRSVersion,
      },
    };
  }

  createSession(rangeIds, order, lexemeIds) {
    const sessionId = `session:${crypto.randomUUID()}`;
    const createdAt = isoNow();
    const insertSession = this.db.prepare(`
      INSERT INTO study_session
        (id, created_at, range_ids_json, item_count, order_name)
      VALUES (?, ?, ?, ?, ?)
    `);
    const insertItem = this.db.prepare(`
      INSERT INTO study_session_item (session_id, position, lexeme_id)
      VALUES (?, ?, ?)
    `);

    this.db.exec('BEGIN IMMEDIATE');
    try {
      insertSession.run(sessionId, createdAt, JSON.stringify(rangeIds), lexemeIds.length, order);
      lexemeIds.forEach((lexemeId, position) => {
        insertItem.run(sessionId, position, lexemeId);
      });
      this.db.exec('COMMIT');
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }

    return { sessionId, createdAt };
  }

  getSession(sessionId) {
    const session = this.db
      .prepare(`
        SELECT id, created_at, range_ids_json, item_count, order_name
        FROM study_session
        WHERE id = ?
      `)
      .get(sessionId);
    if (!session) return null;
    const lexemeIds = this.db
      .prepare(`
        SELECT lexeme_id
        FROM study_session_item
        WHERE session_id = ?
        ORDER BY position
      `)
      .all(sessionId)
      .map((row) => row.lexeme_id);
    return {
      sessionId: session.id,
      createdAt: session.created_at,
      rangeIds: parseJson(session.range_ids_json, []),
      total: session.item_count,
      order: session.order_name,
      lexemeIds,
    };
  }

  sessionContainsLexeme(sessionId, lexemeId) {
    return Boolean(
      this.db
        .prepare(`
          SELECT 1 AS ok
          FROM study_session_item
          WHERE session_id = ? AND lexeme_id = ?
        `)
        .get(sessionId, lexemeId),
    );
  }

  getProgress(lexemeIds) {
    if (lexemeIds.length === 0) return new Map();
    const rows = this.db
      .prepare(`
        SELECT *
        FROM lexeme_progress
        WHERE lexeme_id IN (${placeholders(lexemeIds.length)})
      `)
      .all(...lexemeIds);
    return new Map(rows.map((row) => [row.lexeme_id, mapProgress(row)]));
  }

  getProblemLexemes(lexemeIds, limit) {
    if (lexemeIds.length === 0) return [];
    const where = placeholders(lexemeIds.length);
    const rows = this.db
      .prepare(`
        SELECT
          lexeme_id,
          sum(CASE WHEN rating = 'again' THEN 1 ELSE 0 END) AS again_count,
          sum(CASE WHEN rating = 'good' THEN 1 ELSE 0 END) AS good_count,
          count(*) AS total
        FROM review_event
        WHERE lexeme_id IN (${where})
        GROUP BY lexeme_id
        HAVING again_count > 0
        ORDER BY again_count DESC, total DESC, lexeme_id
      `)
      .all(...lexemeIds)
      .map((row) => ({
        lexemeId: row.lexeme_id,
        againCount: row.again_count,
        goodCount: row.good_count,
        total: row.total,
      }));
    return Number.isInteger(limit) ? rows.slice(0, limit) : rows;
  }

  saveArticle(input) {
    const id = `article:${crypto.randomUUID()}`;
    const createdAt = isoNow();
    this.db.prepare(`
      INSERT INTO generated_article (
        id, created_at, title, body, translation_zh, used_words_json,
        questions_json, selected_lexeme_ids_json, provider, model, level, length
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      createdAt,
      input.article.title,
      input.article.body,
      input.article.translationZh,
      JSON.stringify(input.article.usedWords),
      JSON.stringify(input.article.questions),
      JSON.stringify(input.selectedLexemeIds),
      input.meta.provider,
      input.meta.model,
      input.level,
      input.length,
    );
    return this.getArticle(id);
  }

  listArticles(limit = 100) {
    const safeLimit = Number.isInteger(limit) ? Math.min(Math.max(limit, 1), 200) : 100;
    return this.db.prepare(`
      SELECT id, created_at, title, used_words_json, provider, model, level, length
      FROM generated_article
      ORDER BY created_at DESC, id DESC
      LIMIT ?
    `).all(safeLimit).map(mapArticleListItem);
  }

  getArticle(articleId) {
    const row = this.db.prepare(`
      SELECT id, created_at, title, body, translation_zh, used_words_json,
        questions_json, selected_lexeme_ids_json, provider, model, level, length
      FROM generated_article
      WHERE id = ?
    `).get(articleId);
    return row ? mapArticle(row) : null;
  }

  deleteArticle(articleId) {
    const result = this.db.prepare('DELETE FROM generated_article WHERE id = ?').run(articleId);
    return result.changes > 0;
  }

  recordReview(input) {
    const reviewedAt = normalizeIso(input.reviewedAt, 'reviewedAt');
    const reviewedDate = new Date(reviewedAt);
    const previousRow = this.db
      .prepare('SELECT * FROM lexeme_progress WHERE lexeme_id = ?')
      .get(input.lexemeId);
    const previous = mapProgress(previousRow);
    const beforeCard = fsrsCardFromProgress(previousRow, reviewedDate);
    const grade = input.rating === 'again' ? Rating.Again : Rating.Good;
    const result = FSRS_SCHEDULER.next(beforeCard, reviewedDate, grade);
    const fsrsCard = serializeFsrsCard(result.card);
    const fsrsLog = serializeFsrsLog(result.log);
    const stateBefore = stateToApi(fsrsLog.state);
    const stateAfter = stateToApi(fsrsCard.state);
    const intervalDays = Math.max(
      0,
      (new Date(fsrsCard.due).getTime() - reviewedDate.getTime()) / DAY_MS,
    );
    const retrievability = FSRS_SCHEDULER.get_retrievability(
      fsrsCard,
      reviewedDate,
      false,
    );
    const eventId = `review:${crypto.randomUUID()}`;
    const now = isoNow();
    const afterSnapshot = {
      lexemeId: input.lexemeId,
      due: fsrsCard.due,
      stability: fsrsCard.stability,
      difficulty: fsrsCard.difficulty,
      retrievability,
      lapses: fsrsCard.lapses,
      state: stateAfter,
      reps: fsrsCard.reps,
      againCount: (previous?.againCount ?? 0) + (input.rating === 'again' ? 1 : 0),
      goodCount: (previous?.goodCount ?? 0) + (input.rating === 'good' ? 1 : 0),
      lastReview: fsrsCard.last_review,
      lastIntervalDays: intervalDays,
      scheduler: {
        algorithm: FSRS_ALGORITHM,
        version: FSRS_SCHEMA_VERSION,
        libraryVersion: FSRSVersion,
        fsrsData: fsrsCard,
      },
    };

    const upsertProgress = this.db.prepare(`
      INSERT INTO lexeme_progress (
        lexeme_id, due_at, stability, difficulty, retrievability,
        lapses, state, reps, again_count, good_count, last_review_at,
        last_interval_days, scheduler_algorithm, scheduler_version,
        fsrs_data_json, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(lexeme_id) DO UPDATE SET
        due_at = excluded.due_at,
        stability = excluded.stability,
        difficulty = excluded.difficulty,
        retrievability = excluded.retrievability,
        lapses = excluded.lapses,
        state = excluded.state,
        reps = excluded.reps,
        again_count = excluded.again_count,
        good_count = excluded.good_count,
        last_review_at = excluded.last_review_at,
        last_interval_days = excluded.last_interval_days,
        scheduler_algorithm = excluded.scheduler_algorithm,
        scheduler_version = excluded.scheduler_version,
        fsrs_data_json = excluded.fsrs_data_json,
        updated_at = excluded.updated_at
    `);
    const insertEvent = this.db.prepare(`
      INSERT INTO review_event (
        id, lexeme_id, entry_id, session_id, range_ids_json,
        reviewed_at, rating, rating_value, mode, direction,
        response_ms, flipped_before_answer, was_correct,
        scheduled_days, elapsed_days, state_before, state_after,
        scheduler_algorithm, scheduler_version,
        scheduler_before_json, scheduler_after_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    this.db.exec('BEGIN IMMEDIATE');
    try {
      upsertProgress.run(
        input.lexemeId,
        afterSnapshot.due,
        afterSnapshot.stability,
        afterSnapshot.difficulty,
        afterSnapshot.retrievability,
        afterSnapshot.lapses,
        afterSnapshot.state,
        afterSnapshot.reps,
        afterSnapshot.againCount,
        afterSnapshot.goodCount,
        reviewedAt,
        afterSnapshot.lastIntervalDays,
        FSRS_ALGORITHM,
        FSRS_SCHEMA_VERSION,
        JSON.stringify(fsrsCard),
        previousRow?.created_at ?? now,
        now,
      );
      insertEvent.run(
        eventId,
        input.lexemeId,
        input.entryId ?? null,
        input.sessionId ?? null,
        JSON.stringify(input.rangeIds ?? []),
        reviewedAt,
        input.rating,
        input.rating === 'again' ? 1 : 3,
        input.mode ?? 'flashcard',
        input.direction ?? 'front-to-back',
        input.responseMs ?? null,
        input.flippedBeforeAnswer ? 1 : 0,
        input.rating === 'good' ? 1 : 0,
        fsrsCard.scheduled_days,
        fsrsLog.elapsed_days,
        stateBefore,
        stateAfter,
        FSRS_ALGORITHM,
        FSRS_SCHEMA_VERSION,
        JSON.stringify(beforeCard),
        JSON.stringify({ card: fsrsCard, log: fsrsLog }),
      );
      this.db.exec('COMMIT');
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }

    return {
      event: {
        eventId,
        lexemeId: input.lexemeId,
        entryId: input.entryId ?? null,
        sessionId: input.sessionId ?? null,
        rangeIds: input.rangeIds ?? [],
        reviewedAt,
        rating: input.rating,
        responseMs: input.responseMs ?? null,
        flippedBeforeAnswer: Boolean(input.flippedBeforeAnswer),
        wasCorrect: input.rating === 'good',
      },
      review: afterSnapshot,
      scheduling: {
        algorithm: FSRS_ALGORITHM,
        libraryVersion: FSRSVersion,
        card: fsrsCard,
        log: fsrsLog,
      },
    };
  }

  getSummary(lexemeIds, now = new Date()) {
    if (lexemeIds.length === 0) {
      return emptySummary();
    }

    const where = placeholders(lexemeIds.length);
    const progress = this.db
      .prepare(`
        SELECT
          count(*) AS reviewed_lexemes,
          sum(CASE WHEN due_at <= ? THEN 1 ELSE 0 END) AS due_now,
          sum(CASE WHEN state IN ('learning', 'relearning') THEN 1 ELSE 0 END) AS learning,
          sum(CASE WHEN state = 'review' THEN 1 ELSE 0 END) AS review
        FROM lexeme_progress
        WHERE lexeme_id IN (${where})
      `)
      .get(now.toISOString(), ...lexemeIds);

    const totals = this.db
      .prepare(`
        SELECT
          count(*) AS total_reviews,
          sum(CASE WHEN rating = 'again' THEN 1 ELSE 0 END) AS again_count,
          sum(CASE WHEN rating = 'good' THEN 1 ELSE 0 END) AS good_count,
          avg(response_ms) AS average_response_ms
        FROM review_event
        WHERE lexeme_id IN (${where})
      `)
      .get(...lexemeIds);

    const daily = this.db
      .prepare(`
        SELECT
          substr(reviewed_at, 1, 10) AS date,
          count(*) AS total,
          sum(CASE WHEN rating = 'again' THEN 1 ELSE 0 END) AS again_count,
          sum(CASE WHEN rating = 'good' THEN 1 ELSE 0 END) AS good_count
        FROM review_event
        WHERE lexeme_id IN (${where})
        GROUP BY substr(reviewed_at, 1, 10)
        ORDER BY date
      `)
      .all(...lexemeIds)
      .map((row) => ({
        date: row.date,
        total: row.total,
        again: row.again_count,
        good: row.good_count,
      }));

    const problemLexemes = this.getProblemLexemes(lexemeIds, 20);

    const totalReviews = totals.total_reviews ?? 0;
    const goodCount = totals.good_count ?? 0;
    return {
      totalReviews,
      againCount: totals.again_count ?? 0,
      goodCount,
      accuracy: totalReviews === 0 ? null : goodCount / totalReviews,
      averageResponseMs:
        totals.average_response_ms === null ? null : Math.round(totals.average_response_ms),
      reviewedLexemes: progress.reviewed_lexemes ?? 0,
      dueNow: progress.due_now ?? 0,
      learning: progress.learning ?? 0,
      review: progress.review ?? 0,
      streakDays: calculateStreak(daily.map((row) => row.date), now),
      daily,
      problemLexemes,
    };
  }
}

function mapArticleListItem(row) {
  return {
    articleId: row.id,
    createdAt: row.created_at,
    title: row.title,
    usedWords: parseJson(row.used_words_json, []),
    meta: {
      provider: row.provider,
      model: row.model,
    },
    level: row.level,
    length: row.length,
  };
}

function mapArticle(row) {
  return {
    ...mapArticleListItem(row),
    article: {
      title: row.title,
      body: row.body,
      translationZh: row.translation_zh,
      usedWords: parseJson(row.used_words_json, []),
      questions: parseJson(row.questions_json, []),
    },
    selectedLexemeIds: parseJson(row.selected_lexeme_ids_json, []),
  };
}

function fsrsCardFromProgress(row, reviewedDate) {
  if (!row) {
    return serializeFsrsCard(createEmptyCard(reviewedDate));
  }

  const stored = parseJson(row.fsrs_data_json, null);
  if (
    stored &&
    typeof stored === 'object' &&
    stored.due &&
    Number.isFinite(Number(stored.reps)) &&
    Number.isFinite(Number(stored.state))
  ) {
    return serializeFsrsCard(stored);
  }

  // One-time bridge for a progress DB created by the pre-FSRS P1 prototype.
  return serializeFsrsCard({
    due: row.due_at,
    stability: row.stability,
    difficulty: row.difficulty,
    elapsed_days: 0,
    scheduled_days: Math.max(0, Math.round(row.last_interval_days ?? 0)),
    learning_steps: 0,
    reps: row.reps,
    lapses: row.lapses,
    state: apiStateToFsrs(row.state),
    last_review: row.last_review_at,
  });
}

function serializeFsrsCard(card) {
  return {
    due: normalizeIso(card.due, 'FSRS card due'),
    stability: Number(card.stability),
    difficulty: Number(card.difficulty),
    elapsed_days: Number(card.elapsed_days),
    scheduled_days: Number(card.scheduled_days),
    learning_steps: Number(card.learning_steps),
    reps: Number(card.reps),
    lapses: Number(card.lapses),
    state: Number(card.state),
    last_review: card.last_review ? normalizeIso(card.last_review, 'FSRS last_review') : null,
  };
}

function serializeFsrsLog(log) {
  return {
    rating: Number(log.rating),
    state: Number(log.state),
    due: normalizeIso(log.due, 'FSRS log due'),
    stability: Number(log.stability),
    difficulty: Number(log.difficulty),
    elapsed_days: Number(log.elapsed_days),
    last_elapsed_days: Number(log.last_elapsed_days),
    scheduled_days: Number(log.scheduled_days),
    learning_steps: Number(log.learning_steps),
    review: normalizeIso(log.review, 'FSRS log review'),
  };
}

function stateToApi(state) {
  const numericState = typeof state === 'number' ? state : State[state];
  switch (numericState) {
    case State.New:
      return 'new';
    case State.Learning:
      return 'learning';
    case State.Review:
      return 'review';
    case State.Relearning:
      return 'relearning';
    default:
      throw new Error(`Unknown FSRS state: ${state}`);
  }
}

function apiStateToFsrs(state) {
  switch (state) {
    case 'new':
      return State.New;
    case 'learning':
      return State.Learning;
    case 'review':
      return State.Review;
    case 'relearning':
      return State.Relearning;
    default:
      throw new Error(`Unknown stored review state: ${state}`);
  }
}

function emptySummary() {
  return {
    totalReviews: 0,
    againCount: 0,
    goodCount: 0,
    accuracy: null,
    averageResponseMs: null,
    reviewedLexemes: 0,
    dueNow: 0,
    learning: 0,
    review: 0,
    streakDays: 0,
    daily: [],
    problemLexemes: [],
  };
}

function calculateStreak(dateKeys, now) {
  if (dateKeys.length === 0) return 0;
  const unique = new Set(dateKeys);
  const cursor = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  let streak = 0;

  while (unique.has(cursor.toISOString().slice(0, 10))) {
    streak += 1;
    cursor.setUTCDate(cursor.getUTCDate() - 1);
  }

  return streak;
}

module.exports = {
  CatalogStore,
  ProgressStore,
  FSRS_ALGORITHM,
  FSRS_PARAMETERS,
  FSRS_SCHEMA_VERSION,
  mapProgress,
  normalizeIso,
};
