import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from build_scope import partition_level_members


class LevelBatchPartitionTests(unittest.TestCase):
    def setUp(self):
        self.entries = [
            {
                "id": f"entry:{index}",
                "lexeme_id": f"lexeme:{index}",
                "canonical_term": f"term-{index}",
            }
            for index in range(81)
        ]

    def test_partitions_into_40_card_groups_and_keeps_remainder(self):
        batches = partition_level_members(self.entries, batch_size=40, seed="ceec-v1")

        self.assertEqual([len(batch) for batch in batches], [40, 40, 1])
        self.assertEqual(
            {entry["id"] for batch in batches for entry in batch},
            {entry["id"] for entry in self.entries},
        )

    def test_same_level_partition_is_stable_independent_of_input_order(self):
        forward = partition_level_members(self.entries, batch_size=40, seed="ceec-v1")
        reverse = partition_level_members(list(reversed(self.entries)), batch_size=40, seed="ceec-v1")

        self.assertEqual(
            [[entry["id"] for entry in batch] for batch in forward],
            [[entry["id"] for entry in batch] for batch in reverse],
        )

    def test_a_lexeme_is_not_split_when_it_has_multiple_entries(self):
        entries = self.entries[:41] + [
            {
                "id": "entry:alias",
                "lexeme_id": self.entries[0]["lexeme_id"],
                "canonical_term": self.entries[0]["canonical_term"],
            }
        ]

        batches = partition_level_members(entries, batch_size=40, seed="ceec-v1")
        locations = {
            entry["id"]: batch_index
            for batch_index, batch in enumerate(batches)
            for entry in batch
        }

        self.assertEqual(locations["entry:0"], locations["entry:alias"])
        self.assertEqual(sum(len(batch) for batch in batches), len(entries))


if __name__ == "__main__":
    unittest.main()
