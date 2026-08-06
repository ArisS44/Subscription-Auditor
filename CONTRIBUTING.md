# Contributing

Thanks for taking an interest. This is a personal portfolio project built and maintained by one
person, so it is worth being clear about what is useful and what to expect.

## Suggestions, questions, and bug reports are welcome

Open an [issue](https://github.com/ArisS44/Subscription-Auditor/issues). All of these are genuinely
useful:

- **Bugs** — anything that behaves incorrectly. Please say what you did, what you expected, and what
  happened instead, plus your browser and whether you were on desktop or mobile.
- **Suggestions** — features, UX improvements, or things that read badly.
- **Questions about the approach** — why something is built the way it is. The reasoning is usually
  written down somewhere in [`docs/`](docs/README.md) or the process record in
  [`.apm/`](.apm/archives/README.md), and if it isn't, that is worth knowing.
- **Corrections** — factual errors in the documentation, or Greek translations that read
  unnaturally. The Greek locale in particular benefits from native-speaker review.

## Security issues

Security issues are the exception: please **do not** open a public issue. Use GitHub's private
vulnerability reporting instead —
[report a vulnerability](https://github.com/ArisS44/Subscription-Auditor/security/advisories/new),
also reachable from the repository's **Security** tab. That keeps the report private until it is
fixed.

This is a personal project, so please be realistic about response times. If a report is urgent and
goes unanswered, say so in the advisory thread.

## Pull requests

Small, focused pull requests are welcome — a typo, a clear bug fix, a translation correction. Please
open an issue first for anything larger, so you do not spend time on a change that does not fit the
project's direction.

Be aware that this is a solo project with no service commitment. Responses may be slow, and a
well-made pull request may still be declined if it does not fit where the project is going. That is
not a judgement of the work.

If you do submit code:

- Match the surrounding style. `pre-commit` runs `ruff` + `black` on the backend and
  `eslint` + `prettier` on the frontend — see the README for setup.
- User-facing strings need both `en` and `el` keys, at exact parity.
- The backend validates all input; client-side validation is UX only.
- Run `npm run build` as well as `npm run test` for frontend changes — the build type-checks test
  files in ways the test runner does not.

## Licensing of contributions

This project is licensed under the [PolyForm Noncommercial License 1.0.0](LICENSE). By submitting a
contribution, you agree that it is licensed under the same terms as the rest of the project, and
that you have the right to grant that licence. If you are not comfortable with that, please open an
issue to discuss rather than submitting code.
