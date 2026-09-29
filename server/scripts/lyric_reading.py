"""CPU-only readings for lyric proofreading; offsets use JavaScript UTF-16 units."""
import json
import sys

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")


def main():
    import jaconv
    from sudachipy import Dictionary, SplitMode

    payload = json.load(sys.stdin)
    text = payload["text"]
    tokenizer = Dictionary(dict="full").create()
    tokens = []
    for token in tokenizer.tokenize(text, SplitMode.C):
        reading = token.reading_form()
        kana = jaconv.kata2hira(reading if reading != "*" else token.surface())
        tokens.append({
            "start": len(text[:token.begin()].encode("utf-16-le")) // 2,
            "end": len(text[:token.end()].encode("utf-16-le")) // 2,
            "kana": kana,
        })
    # Same dictionary/conversion used by Whisper, without loading an ASR/GPU model.
    print(json.dumps({"tokens": tokens}, ensure_ascii=False))


if __name__ == "__main__":
    main()
