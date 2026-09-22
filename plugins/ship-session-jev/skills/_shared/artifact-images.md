# Rules for images in Artifacts

When putting screenshots into an Artifact for a completion report from `ship-session` / `issue-loop` / `code-review` / `create-issue`,
**make them click-to-enlarge before publishing**.

- **Why**: placing before / after side by side narrows each image, so the details of a UI diff cannot be read.
  If they cannot be enlarged, you end up reopening the local files anyway, and the Artifact is not complete as a deliverable.

This file is the single source of truth. Each skill's completion-report section only refers here; do not duplicate the spec elsewhere.

---

## Spec

| Item | Rule |
|---|---|
| **Open** | Clicking a thumbnail, and Enter / Space while a thumbnail has focus |
| **Display** | A full-screen overlay. The image is the largest size that fits in the viewport (about 95vw / 95vh) with `object-fit: contain` |
| **Zoom** | **Up to natural size only**. Never enlarge beyond the original image (stretching an image embedded as a data URI adds no information) |
| **Close** | Provide **all three ways to close**: the Esc key / clicking the backdrop of the overlay / an explicit close button |
| **Accessibility** | `role="button"` and `tabindex="0"` on thumbnails. State before / after in `alt`. Do not let the background scroll while open. On close, return focus to the original thumbnail |
| **Theming** | Define the overlay's background color as tokens so that image edges do not blend into the background in either light or dark |
| **Zero images** | The lightbox init code does not throw when there are no target images (write it so it works even when `querySelectorAll` returns nothing) |

### Must do

- **Write it self-contained.** Artifacts are blocked by CSP from talking to external hosts. CDN libraries,
  external CSS, and remote images cannot be loaded. Write CSS and JS inline in the page, and embed images as data URIs
- **Do not substitute `<a download>` or script-triggered downloads.** Neither works in the Artifact sandbox
- **Data URIs count toward the Artifact's 16MB limit.** If you might hit it, shrink the images before embedding.
  The lightbox only enlarges the shrunk image up to its natural size; it does not restore the original resolution
- **Keep before / after side by side.** Being able to enlarge does not make it acceptable to include only `after`

---

## Implementation

A minimal implementation you can paste as-is. You may change class names, but **do not drop the three ways to close or the zero-image safety**.

UI strings in the page (button text, `aria-label`, captions, `alt`) are written in the user's language — see `user-language.md` in the same directory. The English strings below are examples.

### Markup

```html
<div class="shots">
  <figure class="shot">
    <img class="zoomable" role="button" tabindex="0"
         alt="before: sidebar before the change" src="data:image/png;base64,...">
    <figcaption>before</figcaption>
  </figure>
  <figure class="shot">
    <img class="zoomable" role="button" tabindex="0"
         alt="after: sidebar after the change" src="data:image/png;base64,...">
    <figcaption>after</figcaption>
  </figure>
</div>

<div id="lightbox" aria-hidden="true">
  <button id="lightbox-close" type="button" aria-label="Close enlarged view">✕</button>
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
  // Even in a report with no images, exit quietly here instead of throwing
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

  // With zero targets, forEach simply iterates over nothing
  document.querySelectorAll('.zoomable').forEach(function (img) {
    img.addEventListener('click', function () { open(img); });
    img.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(img); }
    });
  });

  closeBtn.addEventListener('click', close);                      // Way 1: close button
  box.addEventListener('click', function (e) {                    // Way 2: clicking the backdrop
    if (e.target === box || e.target === full) close();
  });
  document.addEventListener('keydown', function (e) {             // Way 3: Esc
    if (e.key === 'Escape') close();
  });
})();
```

---

## Check before publishing

After publishing the Artifact, **actually open it and confirm the following before moving on to the completion report**.

- [ ] Clicking a thumbnail enlarges it
- [ ] Esc closes it
- [ ] Clicking the overlay backdrop closes it
- [ ] The close button closes it
- [ ] Image edges do not blend into the background in both light and dark
