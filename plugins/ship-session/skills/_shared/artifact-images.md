# Artifact に画像を貼るときの決まり

`ship-session` / `issue-loop` / `code-review` / `create-issue` の完了報告で Artifact に
スクリーンショットを載せるときは、**クリックで拡大できる状態にしてから公開する**。

- **理由**: before / after を横並びで貼ると1枚あたりの表示幅が狭くなり、UI 差分の細部が読めない。
  拡大できないと結局ローカルのファイルを開き直すことになり、Artifact が成果物として完結しない。

このファイルが唯一の規定。各スキルの完了報告節からはここを参照するだけで、仕様を各所に複製しない。

---

## 仕様

| 項目 | 決まり |
|---|---|
| **開く** | サムネイルのクリック、およびサムネイルにフォーカスした状態での Enter / Space |
| **表示** | 画面全体を覆うオーバーレイ。画像は `object-fit: contain` でビューポート内（およそ 95vw / 95vh）に収まる最大サイズ |
| **拡大率** | **等倍まで**。元画像より大きくしない（data URI で埋めた画像を引き伸ばしても情報は増えない） |
| **閉じる** | Esc キー / オーバーレイ背景のクリック / 明示的な閉じるボタン、の**3経路すべて**を用意する |
| **アクセシビリティ** | サムネイルに `role="button"` と `tabindex="0"`。`alt` に before / after の別を書く。開いている間は背景をスクロールさせない。閉じたらフォーカスを元のサムネイルへ戻す |
| **テーマ対応** | オーバーレイの地の色をトークンで定義し、ライト / ダーク双方で画像の縁が背景に溶けないようにする |
| **画像0枚** | ライトボックスの初期化コードは対象画像が無くてもエラーを投げない（`querySelectorAll` が空を返しても成立する書き方にする） |

### 守ること

- **self-contained で書く。** Artifact は CSP で外部ホストへの通信を禁じられている。CDN のライブラリ・
  外部 CSS・リモート画像は読み込めない。CSS と JS はページ内にインラインで書き、画像は data URI で埋める
- **`<a download>` やスクリプト起動のダウンロードで代替しない。** Artifact のサンドボックスではどちらも動かない
- **data URI は Artifact の 16MB 上限に含まれる。** 触れそうなら貼る前に画像を縮小する。
  ライトボックスは縮小後の画像を等倍まで拡大するだけで、原寸を復元するものではない
- **before / after は横並びのまま。** 拡大できるようになっても、`after` だけを貼ってよいことにはならない

---

## 実装

そのまま貼れる最小の実装。クラス名は変えてよいが、**3経路の閉じ方と画像0枚時の安全性は落とさない**。

### マークアップ

```html
<div class="shots">
  <figure class="shot">
    <img class="zoomable" role="button" tabindex="0"
         alt="before: 変更前のサイドバー" src="data:image/png;base64,...">
    <figcaption>before</figcaption>
  </figure>
  <figure class="shot">
    <img class="zoomable" role="button" tabindex="0"
         alt="after: 変更後のサイドバー" src="data:image/png;base64,...">
    <figcaption>after</figcaption>
  </figure>
</div>

<div id="lightbox" aria-hidden="true">
  <button id="lightbox-close" type="button" aria-label="拡大表示を閉じる">✕</button>
  <img id="lightbox-img" alt="">
</div>
```

### CSS

```css
:root {
  --lightbox-bg: rgba(250, 250, 249, 0.94);
  --lightbox-surface: #ffffff;
  --lightbox-fg: #1c1917;
  --lightbox-border: rgba(0, 0, 0, 0.12);
}
@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) {
    --lightbox-bg: rgba(12, 10, 9, 0.94);
    --lightbox-surface: #1c1917;
    --lightbox-fg: #fafaf9;
    --lightbox-border: rgba(255, 255, 255, 0.18);
  }
}
:root[data-theme="dark"] {
  --lightbox-bg: rgba(12, 10, 9, 0.94);
  --lightbox-surface: #1c1917;
  --lightbox-fg: #fafaf9;
  --lightbox-border: rgba(255, 255, 255, 0.18);
}

.shots { display: flex; flex-wrap: wrap; gap: 1rem; }
.shot { flex: 1 1 18rem; margin: 0; }
.zoomable {
  display: block; width: 100%; height: auto; cursor: zoom-in;
  background: var(--lightbox-surface);
  border: 1px solid var(--lightbox-border); border-radius: 8px;
}
.zoomable:focus-visible { outline: 2px solid currentColor; outline-offset: 3px; }

#lightbox {
  position: fixed; inset: 0; z-index: 999; display: none;
  align-items: center; justify-content: center; padding: 2.5vmin;
  background: var(--lightbox-bg);
}
#lightbox[data-open="true"] { display: flex; }
#lightbox-img {
  max-width: 95vw; max-height: 95vh; width: auto; height: auto;
  object-fit: contain; cursor: zoom-out;
  background: var(--lightbox-surface);
  border: 1px solid var(--lightbox-border); border-radius: 8px;
}
#lightbox-close {
  position: absolute; top: 1rem; right: 1rem;
  width: 2.5rem; height: 2.5rem; font-size: 1.1rem; line-height: 1;
  cursor: pointer; border-radius: 999px;
  color: var(--lightbox-fg);
  background: var(--lightbox-surface);
  border: 1px solid var(--lightbox-border);
}
body.lightbox-open { overflow: hidden; }
```

### JS

```js
(function () {
  var box = document.getElementById('lightbox');
  var full = document.getElementById('lightbox-img');
  var closeBtn = document.getElementById('lightbox-close');
  // 画像を1枚も貼らない報告でも、ここで静かに抜けてエラーにしない
  if (!box || !full || !closeBtn) return;

  var lastFocused = null;

  function open(img) {
    lastFocused = img;
    full.src = img.currentSrc || img.src;
    full.alt = img.alt;
    box.setAttribute('data-open', 'true');
    box.setAttribute('aria-hidden', 'false');
    document.body.classList.add('lightbox-open');
    closeBtn.focus();
  }

  function close() {
    if (box.getAttribute('data-open') !== 'true') return;
    box.removeAttribute('data-open');
    box.setAttribute('aria-hidden', 'true');
    document.body.classList.remove('lightbox-open');
    full.removeAttribute('src');
    if (lastFocused) lastFocused.focus();
  }

  // 対象が0枚なら forEach が空で回るだけで済む
  document.querySelectorAll('.zoomable').forEach(function (img) {
    img.addEventListener('click', function () { open(img); });
    img.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(img); }
    });
  });

  closeBtn.addEventListener('click', close);                      // 経路1: 閉じるボタン
  box.addEventListener('click', function (e) {                    // 経路2: 背景クリック
    if (e.target === box || e.target === full) close();
  });
  document.addEventListener('keydown', function (e) {             // 経路3: Esc
    if (e.key === 'Escape') close();
  });
})();
```

---

## 公開前の確認

Artifact を公開したら、**実際に開いて次を確認してから完了報告に進む**。

- [ ] サムネイルをクリックすると拡大表示される
- [ ] Esc で閉じる
- [ ] オーバーレイの背景クリックで閉じる
- [ ] 閉じるボタンで閉じる
- [ ] ライト / ダークの両方で画像の縁が背景に溶けていない
