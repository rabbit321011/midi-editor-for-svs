import importlib.util
import unittest
from pathlib import Path


class LyricReadingTests(unittest.TestCase):
    def test_formatting_is_not_sung(self):
        path = Path(__file__).parents[1] / 'lyric_reading.py'
        spec = importlib.util.spec_from_file_location('lyric_reading', path)
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        text = '鏡の中から　「おはよう、朝だね」\nいつも通り　表情は最悪\n記号を歌う'
        tokens = module.build_tokens(text)
        self.assertEqual(sum(token['kana'] == 'きごう' for token in tokens), 1)
        self.assertTrue(any(text[token['start']:token['end']] == '記号' and token['kana'] == 'きごう' for token in tokens))
        self.assertFalse(any(text[token['start']:token['end']] in ['　', '\n', '「', '」', '、'] for token in tokens))


if __name__ == '__main__':
    unittest.main()
