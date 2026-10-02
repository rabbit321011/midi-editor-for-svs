"""CPU-only readings for lyric proofreading; offsets use JavaScript UTF-16 units."""
import json
import sys

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")


def build_tokens(text):
    import jaconv
    from sudachipy import Dictionary, SplitMode

    tokenizer = Dictionary(dict="full").create()
    tokens = []
    for token in tokenizer.tokenize(text, SplitMode.C):
        # Sudachi assigns the placeholder reading キゴウ to whitespace.
        # Punctuation is display text too, rather than a sung reading.
        if token.part_of_speech()[0] in {"空白", "補助記号"}:
            continue
        reading = token.reading_form()
        kana = jaconv.kata2hira(reading if reading != "*" else token.surface())
        tokens.append({
            "start": len(text[:token.begin()].encode("utf-16-le")) // 2,
            "end": len(text[:token.end()].encode("utf-16-le")) // 2,
            "kana": kana,
        })
    # Same dictionary/conversion used by Whisper, without loading an ASR/GPU model.
    return tokens


def main():
    payload = json.load(sys.stdin)
    print(json.dumps({"tokens": build_tokens(payload["text"])}, ensure_ascii=False))


if __name__ == "__main__":
    main()
