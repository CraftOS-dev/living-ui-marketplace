/**
 * Licensed products: every item a licensee makes under one of our
 * licences, from the first proposal to the last sell-off day. Filters by
 * stage, licensee, franchise, character, occasion and licence; each row
 * links to the product and to "Can we?" for its first character.
 */
import { useMemo, useState } from 'react';
import { Package, Plus, Search } from 'lucide-react';
import { Button, Input, Select } from '../../kit/index.ts';
import { useCollection } from '../lib/live.ts';
import { useApp } from '../lib/context.tsx';
import { d10, fmtDate, fmtMoney } from '../lib/format.ts';
import { enumOptions, joinList, t } from '../lib/i18n.ts';
import { href, navigate, useHashParam } from '../lib/router.ts';
import type { AgreementRec, PartyRec, ProductRec } from '../lib/records.ts';
import { DataTable } from '../components/DataTable.tsx';
import type { Col } from '../components/DataTable.tsx';
import { EmptyHint, EnumPill, ErrorBox, ListRow, Loading, PageHeader, Ref, Section, Toolbar } from '../components/ui.tsx';
import { canDelete } from '../components/deleteRecord.tsx';
import { PRODUCT_STAGES, RowDelete, expandOne } from '../components/licShared.tsx';
import { ProductFormDialog } from '../components/licProductForm.tsx';

export function ProductsPage(): React.JSX.Element {
  const { can, on, characters, franchises, dimLabel, nameOf } = useApp();
  const all = useCollection<ProductRec>('products', { sort: '-updated', expand: 'licensee,agreement' });
  const [stage, setStage] = useHashParam('stage', '');
  const [licensee, setLicensee] = useHashParam('licensee', '');
  const [franchise, setFranchise] = useHashParam('franchise', '');
  const [character, setCharacter] = useHashParam('character', '');
  const [occasion, setOccasion] = useHashParam('occasion', '');
  const [agreement, setAgreement] = useHashParam('agreement', '');
  const [search, setSearch] = useState('');
  const [creating, setCreating] = useState(false);

  const mayDelete = canDelete(can, 'products');
  const licenseeOf = (p: ProductRec): string => expandOne<PartyRec>(p, 'licensee')?.name ?? '';
  const agreementOf = (p: ProductRec): AgreementRec | null => expandOne<AgreementRec>(p, 'agreement');
  const characterNames = (p: ProductRec): string => joinList(p.characters.map((c) => nameOf('character', c)).filter((n) => n !== ''));

  const licenseeOptions = useMemo(() => {
    const m = new Map<string, string>();
    for (const p of all.records) {
      const party = expandOne<PartyRec>(p, 'licensee');
      if (party !== null) m.set(party.id, party.name);
    }
    return [...m.entries()].sort((a, b) => a[1].localeCompare(b[1])).map(([value, label]) => ({ value, label }));
  }, [all.records]);
  const agreementOptions = useMemo(() => {
    const m = new Map<string, string>();
    for (const p of all.records) {
      const a = expandOne<AgreementRec>(p, 'agreement');
      if (a !== null) m.set(a.id, `${a.ref} ${a.title}`.trim());
    }
    return [...m.entries()].sort((a, b) => a[1].localeCompare(b[1])).map(([value, label]) => ({ value, label }));
  }, [all.records]);

  const rows = useMemo(() => {
    const term = search.trim().toLowerCase();
    return all.records.filter((p) => {
      if (stage !== '' && p.stage !== stage) return false;
      if (licensee !== '' && p.licensee !== licensee) return false;
      if (franchise !== '' && p.franchise !== franchise) return false;
      if (character !== '' && !p.characters.includes(character)) return false;
      if (occasion !== '' && p.occasion !== occasion) return false;
      if (agreement !== '' && p.agreement !== agreement) return false;
      if (term !== '') {
        const hay = `${p.name} ${p.ref} ${p.sku} ${p.jan}`.toLowerCase();
        if (!hay.includes(term)) return false;
      }
      return true;
    });
  }, [all.records, stage, licensee, franchise, character, occasion, agreement, search]);

  const filtered = stage !== '' || licensee !== '' || franchise !== '' || character !== '' || occasion !== '' || agreement !== '' || search.trim() !== '';
  const clear = (): void => {
    setStage('');
    setLicensee('');
    setFranchise('');
    setCharacter('');
    setOccasion('');
    setAgreement('');
    setSearch('');
  };

  const canWeLink = (p: ProductRec): React.JSX.Element | null => {
    const first = p.characters[0];
    if (first === undefined) return null;
    return (
      <a
        href={href('canwe', undefined, { asset: `character:${first}` })}
        onClick={(e) => e.stopPropagation()}
        className="whitespace-nowrap text-xs text-[var(--agent-app-accent)] hover:underline"
        title={t('Check the rights for {name}', { name: nameOf('character', first) })}
      >
        {t('Can we?')}
      </a>
    );
  };

  const columns: Col<ProductRec>[] = [
    { key: 'ref', label: t('Reference'), render: (p) => <Ref className="whitespace-nowrap">{p.ref}</Ref> },
    { key: 'name', label: t('Name'), render: (p) => <span className="block max-w-[18rem] truncate font-medium">{p.name}</span> },
    { key: 'licensee', label: t('Licensee'), value: licenseeOf, render: (p) => <span className="block max-w-[12rem] truncate">{licenseeOf(p)}</span> },
    { key: 'agreement', label: t('Licence'), value: (p) => agreementOf(p)?.ref ?? '', render: (p) => <Ref className="whitespace-nowrap">{agreementOf(p)?.ref ?? ''}</Ref> },
    ...(on('franchises')
      ? [{ key: 'characters', label: t('Characters'), value: characterNames, render: (p: ProductRec) => <span className="block max-w-[14rem] truncate">{characterNames(p)}</span> }]
      : []),
    { key: 'category', label: t('Category'), value: (p) => (p.category !== '' ? dimLabel('category', p.category) : ''), render: (p) => <span className="block max-w-[12rem] truncate">{p.category !== '' ? dimLabel('category', p.category) : ''}</span> },
    { key: 'stage', label: t('Stage|product'), value: (p) => PRODUCT_STAGES.indexOf(p.stage as (typeof PRODUCT_STAGES)[number]), render: (p) => <EnumPill field="products.stage" value={p.stage} /> },
    { key: 'sales_start', label: t('Sales start'), value: (p) => d10(p.sales_start), render: (p) => <span className="whitespace-nowrap">{fmtDate(p.sales_start)}</span> },
    { key: 'retail_price', label: t('Retail price'), align: 'right', value: (p) => p.retail_price, render: (p) => <span className="whitespace-nowrap">{p.retail_price ? fmtMoney(p.retail_price, p.currency) : ''}</span> },
    { key: 'sku', label: t('SKU'), optional: true, render: (p) => <Ref>{p.sku}</Ref> },
    { key: 'jan', label: t('JAN code'), optional: true, render: (p) => <Ref>{p.jan}</Ref> },
    ...(on('franchises') ? [{ key: 'canwe', label: t('Rights'), sortable: false, value: () => '', render: (p: ProductRec) => canWeLink(p) ?? '' }] : []),
    ...(mayDelete
      ? [
          {
            key: 'delete',
            label: t('Actions'),
            sortable: false,
            value: () => '',
            render: (p: ProductRec) => (
              <div className="flex justify-end">
                <RowDelete collection="products" id={p.id} label={t('Delete {name}', { name: p.name })} />
              </div>
            ),
          },
        ]
      : []),
  ];

  const newButton = can.edit ? (
    <Button onClick={() => setCreating(true)}>
      <Plus size={14} aria-hidden /> {t('New product')}
    </Button>
  ) : undefined;

  const noMatch = (
    <EmptyHint
      compact
      icon={Search}
      title={t('Nothing matches these filters')}
      message={t('Try another stage, licensee or licence.')}
      action={
        <Button size="sm" variant="outline" onClick={clear}>
          {t('Clear filters')}
        </Button>
      }
    />
  );

  const characterOptions = characters.filter((c) => franchise === '' || c.franchise === franchise).map((c) => ({ value: c.id, label: c.name }));

  return (
    <div>
      <PageHeader
        title={t('Products')}
        meta={all.loading ? undefined : String(all.records.length)}
        subtitle={t('Licensed items from the first proposal to the last sell-off day. Approvals, seals and royalties follow each one.')}
        actions={newButton}
      />

      <Toolbar>
        <div className="w-full sm:w-56">
          <Input aria-label={t('Search')} placeholder={t('Name, reference, SKU or JAN')} value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <div className="w-full sm:w-40">
          <Select aria-label={t('Stage|product')} value={stage} placeholder={t('All stages')} options={enumOptions('products.stage').map(([value, label]) => ({ value, label }))} onChange={(e) => setStage(e.target.value)} />
        </div>
        <div className="w-full sm:w-48">
          <Select aria-label={t('Licensee')} value={licensee} placeholder={t('All licensees')} options={licenseeOptions} onChange={(e) => setLicensee(e.target.value)} />
        </div>
        <div className="w-full sm:w-48">
          <Select aria-label={t('Licence')} value={agreement} placeholder={t('All licences')} options={agreementOptions} onChange={(e) => setAgreement(e.target.value)} />
        </div>
        {on('franchises') && (
          <>
            <div className="w-full sm:w-44">
              <Select aria-label={t('Franchise')} value={franchise} placeholder={t('All franchises')} options={franchises.map((f) => ({ value: f.id, label: f.name }))} onChange={(e) => setFranchise(e.target.value)} />
            </div>
            <div className="w-full sm:w-44">
              <Select aria-label={t('Character')} value={character} placeholder={t('All characters')} options={characterOptions} onChange={(e) => setCharacter(e.target.value)} />
            </div>
          </>
        )}
        <div className="w-full sm:w-40">
          <Select aria-label={t('Occasion')} value={occasion} placeholder={t('All occasions')} options={enumOptions('products.occasion').map(([value, label]) => ({ value, label }))} onChange={(e) => setOccasion(e.target.value)} />
        </div>
        {filtered && (
          <Button size="sm" variant="ghost" onClick={clear}>
            {t('Clear filters')}
          </Button>
        )}
      </Toolbar>

      {all.error !== null && all.records.length === 0 ? (
        <ErrorBox message={all.error} onRetry={all.refresh} />
      ) : all.loading ? (
        <Loading />
      ) : all.records.length === 0 ? (
        <Section title={t('Products')}>
          <EmptyHint
            icon={Package}
            title={t('No products yet')}
            message={t('Add a product when a licensee proposes an item under one of your licences. Its approvals, seals and royalties are then kept with it.')}
            action={newButton}
          />
        </Section>
      ) : (
        <Section title={t('Products')} meta={filtered ? t('{n} shown', { n: rows.length }) : undefined} flush>
          <div className="hidden md:block">
            <DataTable<ProductRec> tableId="products" exportName="products" rows={rows} columns={columns} dense onRowClick={(p) => navigate('product', p.id)} empty={noMatch} />
          </div>
          <div className="md:hidden">
            {rows.length === 0
              ? noMatch
              : rows.map((p) => (
                  <ListRow
                    key={p.id}
                    onClick={() => navigate('product', p.id)}
                    primary={p.name}
                    secondary={[p.ref, licenseeOf(p), p.category !== '' ? dimLabel('category', p.category) : ''].filter((x) => x !== '').join(' · ')}
                    trailing={
                      <span className="flex items-center gap-1">
                        <EnumPill field="products.stage" value={p.stage} />
                        {mayDelete && <RowDelete collection="products" id={p.id} label={t('Delete {name}', { name: p.name })} />}
                      </span>
                    }
                  />
                ))}
          </div>
        </Section>
      )}

      {creating && <ProductFormDialog onClose={() => setCreating(false)} onSaved={(p) => navigate('product', p.id)} />}
    </div>
  );
}
