# GitHub Pages Footguns

- Defining a collection with a hyphen (e.g. `research-notes`) means Liquid will never expose it as `site.research-notes`; GitHub Pages wants underscores (`research_notes`) while the `permalink` can still keep hyphens.
- Files without top-of-file YAML front matter (or with a blank line before the opening `---`) are treated as static assets, so collection documents like `gpt2-notes.md` silently vanish from the build.
- Renaming files without matching front matter slugs changes their URLs and breaks existing links; always update `slug` when adjusting filenames to keep canonical paths stable.
- GitHub Pages/CDN caches are sticky; after pushing fixes, force-refresh (`Cache-Control: no-cache`) before assuming a change didn’t deploy.
