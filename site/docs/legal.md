# Legal and notice

## Unofficial fan project

Mars Ledger is an unofficial fan-made companion for the Terraforming Mars board game. It is not affiliated with
or endorsed by FryxGames, Stronghold Games or Asmodee. Terraforming Mars is a trademark of FryxGames. You need a
copy of the board game to play.

Mars Ledger contains no FryxGames logos, box art or card art.

## Licence

Mars Ledger is free software under the GNU Affero General Public License, version 3 only (`AGPL-3.0-only`). See
`LICENSE` in the repository. If you run a changed version for other people over a network, you must offer them
its source.

## The Terraforming Mars engine

For full games, the open-source
[Terraforming Mars engine](https://github.com/terraforming-mars/terraforming-mars) (GPL-3.0) is run unmodified in
its own container. The card data and maps are extracted from it at build time and
not stored in this repository. A few files in Mars Ledger are derived from the engine: the extract tools, the
card behaviour format and the hand-written card overrides. GPLv3 section 13 allows them to be combined with the
AGPL-3.0 code. Thanks to the engine's authors and contributors; Mars Ledger would not exist without their work.

## Art and other assets

- The card illustrations, corporation portraits, poster paintings and event scenes were generated for this
  project and are licensed under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). The prompts are
  in the manifests next to the images.
- The Mars colour and elevation maps come from USGS Astrogeology (Viking and MOLA mosaics) and are in the public
  domain.
- The Saira font is under the SIL Open Font License 1.1.
- Every sound is synthesized in the browser.

The full list is in
[THIRD_PARTY.md](https://github.com/murtaza-nasir/mars-ledger/blob/main/THIRD_PARTY.md).

## Contributing

Pull requests are welcome. Contributions are accepted under the AGPL-3.0, the same licence as the project. There
is no contributor licence agreement.
