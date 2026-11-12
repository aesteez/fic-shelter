# Fic Shelter

A temporary, fan-run reading archive while AO3 is down for maintenance.
Anyone can read it **without an account**. People who share fics upload the
HTML or EPUB files they downloaded from AO3; the site keeps each fic's original
author, tags and link.

Not affiliated with AO3 or the Organization for Transformative Works.

## Sharing fics

1. Get added as a collaborator on this repository (you need a free GitHub account).
2. Open the [`fics/`](fics/) folder → **Add file → Upload files**.
3. Drag in the `.html` or `.epub` files (several at once is fine) and press **Commit changes**.
4. In 1–2 minutes the site rebuilds itself. The build summary in the **Actions**
   tab lists any file that was skipped and why.

PDF, MOBI and AZW3 can't be read. Fics with the "Underage" warning are skipped.

## Taking a fic down

If an author asks for their work to be removed:

- delete its file from `fics/`, **and/or**
- add its AO3 link to [`takedown.txt`](takedown.txt) so it never comes back, even if someone uploads it again.

## Comments (optional)

Comments use [giscus](https://giscus.app) (stored in GitHub Discussions; reading needs no account,
commenting needs a GitHub account):

1. In the repository settings, turn on **Discussions** and create a category called `Comments`.
2. Install the giscus app: https://github.com/apps/giscus
3. On https://giscus.app, enter this repository, pick the `Comments` category, and copy the
   `data-repo-id` and `data-category-id` values into the `giscus` section of [`config.json`](config.json).

## Running it locally

```bash
npm install
npm run build
```

The site is written to `_site/`.
