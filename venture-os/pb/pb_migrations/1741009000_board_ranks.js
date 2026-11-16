/// <reference path="../pb_data/types.d.ts" />
/**
 * Venture OS board order (fix 3): a person sorts cards inside a board column.
 *
 * - `deals.board_rank`: the deal's place inside its stage column on the deal
 *   board (lower first; 0 means "not placed yet": such deals follow the placed
 *   ones, longest in stage first). `deals.move` puts a moved deal back to 0; `deals.reorder` places it.
 * - `asks.rank`: the ask's place inside its status column on a portfolio
 *   company's asks board (placed first, then the rest newest first). `asks.reorder` places it;
 *   `asks.update` with a new status puts it back to 0.
 */
migrate(
  (app) => {
    const deals = app.findCollectionByNameOrId('deals');
    if (!deals.fields.getByName('board_rank')) deals.fields.add(new NumberField({ name: 'board_rank', onlyInt: true, min: 0 }));
    app.save(deals);
    const asks = app.findCollectionByNameOrId('asks');
    if (!asks.fields.getByName('rank')) asks.fields.add(new NumberField({ name: 'rank', onlyInt: true, min: 0 }));
    app.save(asks);
  },
  (app) => {
    const deals = app.findCollectionByNameOrId('deals');
    if (deals.fields.getByName('board_rank')) deals.fields.removeByName('board_rank');
    app.save(deals);
    const asks = app.findCollectionByNameOrId('asks');
    if (asks.fields.getByName('rank')) asks.fields.removeByName('rank');
    app.save(asks);
  },
);
