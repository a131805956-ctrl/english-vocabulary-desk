import http from 'node:http';

const port = Number(process.env.MOCK_AI_PORT ?? 11434);
const host = '127.0.0.1';

const server = http.createServer(async (request, response) => {
  if (request.method === 'GET' && request.url === '/api/tags') {
    return sendJson(response, 200, { models: [{ name: 'vocab-test-model' }] });
  }

  if (
    request.method !== 'POST'
    || (request.url !== '/api/chat' && request.url !== '/v1/chat/completions')
  ) {
    return sendJson(response, 404, { error: 'not found' });
  }

  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  const payload = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  const userMessage = payload.messages?.findLast?.((message) => message.role === 'user')?.content ?? '';
  const vocabularyMatch = userMessage.match(/Vocabulary data: (\[[\s\S]+\])$/u);
  const vocabulary = vocabularyMatch ? JSON.parse(vocabularyMatch[1]) : [];
  const words = vocabulary.map((item) => item.word);
  const article = {
    title: 'The Archive at Dawn',
    body: `At dawn, Mia opened an old language archive. Her list included ${words.join(', ')}. She used each term while describing the objects around her, then wrote a clear note for the next learner.\n\nBy the end of the visit, the unfamiliar words felt connected to one memorable story instead of separate facts.`,
    translationZh: `清晨，米雅打開一座古老的語言檔案館。她的清單包括 ${words.join('、')}。她一邊描述身邊的物件，一邊使用每個單字，接著為下一位學習者寫下清楚的筆記。\n\n參觀結束時，原本陌生的字已經連成一個容易記住的故事，不再只是零散資訊。`,
    usedWords: words,
    questions: [
      { question: 'Where did Mia go at dawn?', answer: 'She went to an old language archive.' },
      { question: 'How did she practice the words?', answer: 'She used them while describing objects.' },
      { question: 'Why did the words become easier to remember?', answer: 'They were connected in one story.' },
    ],
  };
  const content = JSON.stringify(article);

  if (request.url === '/api/chat') {
    return sendJson(response, 200, { message: { role: 'assistant', content }, done: true });
  }
  return sendJson(response, 200, { choices: [{ message: { role: 'assistant', content } }] });
});

server.listen(port, host, () => {
  console.log(`Mock local AI listening at http://${host}:${port}`);
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.once(signal, () => server.close(() => process.exit(0)));
}

function sendJson(response, status, body) {
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
  response.end(JSON.stringify(body));
}
