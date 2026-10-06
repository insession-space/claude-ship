"""Issue 本文の受け入れ条件のうち、指定した番号の条件の行だけチェックを付ける（外す）。

使い方:
    python3 -I tick_criteria.py <body.md> --list
    python3 -I tick_criteria.py <body.md> [--untick] <番号>...

- 受け入れ条件の見出し（受け入れ条件 / 受入条件 / 完了条件 / Acceptance criteria /
  Definition of done、後ろの補足のカッコは可）の下と、その小見出しの下のチェックリストだけを見る。
  そうした見出しが本文に無いときは、本文のチェックリスト全部を見る
- 条件は上から 1, 2, 3 … と番号で指定する。`--list` で番号と文の一覧を出す。
  本文の文をコマンド行に書かせないのは、本文が信頼できないデータで、シェルに渡すと
  `$(...)` などが展開されるため。番号なら同じ書き出しの条件を取り違えることもない
- コードフェンスと HTML コメントの中は触らない。それ以外の行は1バイトも変えない
- 番号が範囲外のとき、または数字でないときは、何も書き込まずに終了コード 1 で終わる
"""
import re
import sys

HEADING = re.compile(r"^\s{0,3}(#{1,6})\s+(.*?)\s*#*\s*$")
ACCEPTANCE = re.compile(
    r"^(受け入れ条件|受入条件|完了条件|acceptance criteria|definition of done)\s*(\(.*\)|（.*）)?\s*:?$", re.I
)
FENCE = re.compile(r"^\s{0,3}(`{3,}|~{3,})(.*)$")
ITEM = re.compile(r"^(\s*(?:[-*+]|\d+[.)])\s+\[)([ xX])(\]\s+)(.*)$")


def scan(lines):
    """各行について (受け入れ条件の節の中か, チェック項目か) を返す。"""
    out = []
    fence = None
    in_comment = False
    level = None
    for line in lines:
        if in_comment:
            if "-->" in line:
                in_comment = False
            out.append((False, False))
            continue
        f = FENCE.match(line)
        if fence is not None:
            if f and f.group(1)[0] == fence[0] and len(f.group(1)) >= len(fence) and f.group(2).strip() == "":
                fence = None
            out.append((False, False))
            continue
        if f and not (f.group(1).startswith("`") and "`" in f.group(2)):
            fence = f.group(1)
            out.append((False, False))
            continue
        if "<!--" in line and "-->" not in line.split("<!--", 1)[1]:
            in_comment = True
            out.append((False, False))
            continue
        h = HEADING.match(line)
        if h:
            text = re.sub(r"(\*\*|__|`)", "", h.group(2)).strip()
            depth = len(h.group(1))
            if ACCEPTANCE.match(text):
                level = depth
            elif level is not None and depth <= level:
                level = None
            out.append((False, False))
            continue
        out.append((level is not None, ITEM.match(line) is not None))
    return out


def main(argv):
    if len(argv) < 3:
        print(__doc__, file=sys.stderr)
        return 2
    path, rest = argv[1], argv[2:]
    raw = open(path, encoding="utf-8", newline="").read()
    lines = raw.split("\n")
    marks = scan([l.rstrip("\r") for l in lines])
    has_section = any(in_ac and is_item for in_ac, is_item in marks)
    # 受け入れ条件の項目の行番号（上から順）
    items = [i for i, (in_ac, is_item) in enumerate(marks) if is_item and (in_ac or not has_section)]

    if rest == ["--list"]:
        for n, i in enumerate(items, 1):
            m = ITEM.match(lines[i])
            print("%d [%s] %s" % (n, m.group(2), m.group(4).rstrip("\r")))
        return 0

    untick = rest[:1] == ["--untick"]
    wanted = rest[1:] if untick else rest
    if not wanted:
        print(__doc__, file=sys.stderr)
        return 2
    bad = [w for w in wanted if not w.isdigit() or not 1 <= int(w) <= len(items)]
    if bad:
        print("not a criterion number (1-%d): %s" % (len(items), " ".join(bad)), file=sys.stderr)
        return 1

    for w in wanted:
        i = items[int(w) - 1]
        m = ITEM.match(lines[i])
        lines[i] = m.group(1) + (" " if untick else "x") + m.group(3) + m.group(4)
    open(path, "w", encoding="utf-8", newline="").write("\n".join(lines))
    print("%s %d" % ("unticked" if untick else "ticked", len(set(wanted))))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
