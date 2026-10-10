/// <reference path="../pb_data/types.d.ts" />
/**
 * Categories wear a line icon instead of an emoji: add `icon`, give the
 * starter categories theirs (others get the plain tag), drop `emoji`.
 */
migrate(
  (app) => {
    const col = app.findCollectionByNameOrId('categories');
    col.fields.add(new TextField({ name: 'icon', max: 40 }));
    app.save(col);

    const starter = {
      'Food and drink': 'utensils',
      Groceries: 'shopping-cart',
      Transport: 'bus',
      Shopping: 'shopping-bag',
      Bills: 'zap',
      Home: 'home',
      Health: 'heart-pulse',
      Fun: 'film',
      Travel: 'plane',
      Subscriptions: 'repeat',
      Gifts: 'gift',
      Other: 'package',
    };
    for (const r of app.findRecordsByFilter('categories', "id != ''", '', 0, 0)) {
      r.set('icon', starter[r.getString('name')] || 'tag');
      app.save(r);
    }

    const again = app.findCollectionByNameOrId('categories');
    again.fields.removeByName('emoji');
    app.save(again);
  },
  (app) => {
    const col = app.findCollectionByNameOrId('categories');
    col.fields.add(new TextField({ name: 'emoji', max: 16 }));
    app.save(col);
    const again = app.findCollectionByNameOrId('categories');
    again.fields.removeByName('icon');
    app.save(again);
  },
);
