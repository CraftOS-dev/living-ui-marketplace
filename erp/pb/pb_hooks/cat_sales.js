/**
 * Catalog: customers and suppliers, and the document engine (quotes,
 * orders, deliveries, invoices, credit notes, purchase orders, goods
 * receipts, bills, supplier credits).
 */
const s = (desc, x) => Object.assign({ type: 'string', desc: desc }, x || {});
const r = (desc, example) => ({ type: 'string', required: true, desc: desc, example: example });
const b = (desc) => ({ type: 'boolean', desc: desc });
const n = (desc) => ({ type: 'number', desc: desc });
const e = (desc, values) => ({ type: 'string', desc: desc, enum: values });
const re = (desc, values) => ({ type: 'string', required: true, desc: desc, enum: values });
const page = { limit: n('How many to return (default 50)'), offset: n('Skip this many (paging)') };

const TYPES = ['quote', 'sales_order', 'delivery', 'invoice', 'credit_note', 'purchase_order', 'goods_receipt', 'bill', 'supplier_credit'];
const DOC = 'Document number (INV-00012) or id';
const LINES = 'JSON list of lines: [{"item":"SKU-00001","qty":2,"unit_price":"12.50","discount":"10","tax":"SR9","description":"...","account":"4000","project":"PRJ-0001"}]. Item can be a SKU, barcode or exact name; omit unit_price to use the item price; tax "none" for no tax.';

const partyFields = {
  name: s('Name'),
  code: s('Code (automatic when empty)'),
  is_customer: b('A customer'),
  is_supplier: b('A supplier'),
  email: s('Email'),
  phone: s('Phone'),
  website: s('Website'),
  tax_id: s('Their tax number'),
  billing_address: s('Billing address'),
  shipping_address: s('Shipping address'),
  contact_name: s('Contact person'),
  terms: s('Payment terms (Net 30, ...)'),
  currency: s('Their usual currency (empty: base)'),
  credit_limit: s('Credit limit in the base currency (0: none)'),
  sale_tax: s('Default sales tax for them'),
  purchase_tax: s('Default purchase tax from them'),
  notes: s('Notes'),
  archived: b('Archived'),
};

const header = {
  party: s('Customer or supplier: name, code or id'),
  date: s('Document date YYYY-MM-DD (default today)'),
  due_date: s('Due date YYYY-MM-DD (default from the payment terms)'),
  valid_until: s('Quotes: valid until YYYY-MM-DD'),
  expected_date: s('Orders: expected delivery YYYY-MM-DD'),
  terms: s('Payment terms'),
  currency: s('Currency (default the party currency, else base)'),
  fx_rate: s('Exchange rate: base units for one unit of the currency'),
  prices_include_tax: b('Prices include tax'),
  reference: s('Their reference: customer PO or supplier invoice number'),
  attention: s('Contact person'),
  billing_address: s('Billing address'),
  shipping_address: s('Shipping address'),
  warehouse: s('Warehouse stock moves from or to'),
  project: s('Project'),
  department: s('Department'),
  moves_stock: b('Invoices, bills and credits: also move the stock (default true)'),
  notes: s('Notes printed on the document'),
  internal_note: s('Internal note (not printed)'),
  agent_note: s('Your AI agent: why you made it, in a sentence or two'),
};

module.exports = [
  /* parties */
  { name: 'parties.list', method: 'GET', fn: 'lib_parties.list', perm: 'self', desc: 'Customers and suppliers with what they owe and are owed, what is overdue and their latest activity (counts and totals cover every active customer or supplier of the role asked, not only the rows returned).', params: Object.assign({ q: s('Search name, code, email, contact, phone'), role: e('customer, supplier or all', ['customer', 'supplier', 'all']), archived: e('active, archived or all', ['active', 'archived', 'all']), owing: e('Only those with a balance (receivable, payable), or with invoices or bills past due (overdue)', ['receivable', 'payable', 'overdue']), sort: e('Sort (recent: latest activity first)', ['name', 'code', 'created', 'receivable', 'payable', 'recent']), desc: b('Descending') }, page) },
  { name: 'parties.get', method: 'GET', fn: 'lib_parties.get', perm: 'self', desc: 'One customer or supplier: balances, aging, contacts, recent documents, unapplied payments.', params: { party: r('Name, code or id') } },
  { name: 'parties.add', method: 'POST', fn: 'lib_parties.add', perm: 'self', desc: 'Add a customer or supplier. Your AI agent gets the existing one back (409) when the name is taken, unless same_name is true.', params: Object.assign({}, partyFields, { name: r('Name'), same_name: b('Your AI agent: true to add a second, different party with a name that is already used') }) },
  { name: 'parties.update', method: 'POST', fn: 'lib_parties.update', perm: 'self', desc: 'Change a customer or supplier.', params: Object.assign({ party: r('Name, code or id') }, partyFields) },
  { name: 'parties.delete', method: 'POST', fn: 'lib_parties.remove', perm: 'self', destructive: true, desc: 'Delete a customer or supplier with no history (archive the others).', params: { party: r('Name, code or id'), preview: b('Only say what would happen') } },
  { name: 'parties.statement', method: 'GET', fn: 'lib_parties.statement', perm: 'self', desc: 'Statement of account: opening balance, every entry, closing balance.', params: { party: r('Name, code or id'), side: e('receivable or payable', ['receivable', 'payable']), from: s('From YYYY-MM-DD'), to: s('To YYYY-MM-DD') } },
  { name: 'contacts.add', method: 'POST', fn: 'lib_parties.addContact', perm: 'self', desc: 'Add a contact person to a party.', params: { party: r('Party'), name: r('Name'), email: s('Email'), phone: s('Phone'), title: s('Job title'), primary: b('The main contact') } },
  { name: 'contacts.update', method: 'POST', fn: 'lib_parties.updateContact', perm: 'self', desc: 'Change a contact.', params: { contact: r('Contact id'), name: s('Name'), email: s('Email'), phone: s('Phone'), title: s('Job title'), primary: b('The main contact') } },
  { name: 'contacts.delete', method: 'POST', fn: 'lib_parties.removeContact', perm: 'self', destructive: true, desc: 'Remove a contact.', params: { contact: r('Contact id') } },

  /* documents */
  {
    name: 'docs.list',
    method: 'GET',
    fn: 'lib_docs.list',
    perm: 'self',
    desc: 'Documents of one type with filters, totals and counts per status.',
    params: Object.assign(
      {
        type: re('Document type', TYPES),
        status: e('Status filter', ['draft', 'open', 'posted', 'void', 'cancelled', 'unpaid', 'overdue', 'partly_paid', 'paid', 'sent', 'expired', 'accepted', 'declined', 'to_fulfil', 'to_bill', 'done', 'credit_open']),
        party: s('Customer or supplier'),
        project: s('Project'),
        q: s('Search number, reference, party'),
        from: s('Date from YYYY-MM-DD'),
        to: s('Date to YYYY-MM-DD'),
        agent: b('Only those your AI agent prepared'),
        sort: e('Sort', ['date', 'number', 'total', 'due', 'party', 'created']),
        desc: b('Descending'),
      },
      page,
    ),
  },
  { name: 'docs.get', method: 'GET', fn: 'lib_docs.get', perm: 'self', desc: 'One document: header, lines, totals, taxes, flow (what it came from and became), payments, journal, what you can do next.', params: { doc: r(DOC) } },
  { name: 'docs.create', method: 'POST', fn: 'lib_docs.create', perm: 'self', desc: 'Create a draft document. ' + LINES, params: Object.assign({ type: re('Document type', TYPES), lines: s(LINES), source: s('The document it comes from') }, header) },
  { name: 'docs.update', method: 'POST', fn: 'lib_docs.update', perm: 'self', desc: 'Change a draft (or an open quote or order); lines replaces all lines.', params: Object.assign({ doc: r(DOC), lines: s(LINES) }, header) },
  { name: 'docs.set-lines', method: 'POST', fn: 'lib_docs.setLines', perm: 'self', desc: "Replace a draft's lines (keep a line's id to keep it).", params: { doc: r(DOC), lines: r(LINES) } },
  { name: 'docs.add-line', method: 'POST', fn: 'lib_docs.addLine', perm: 'self', desc: 'Add a line (the same item again adds to its quantity).', params: { doc: r(DOC), item: s('Item'), description: s('Description'), qty: r('Quantity', '2'), unit: s('Unit'), unit_price: s('Unit price'), discount: s('Discount %'), tax: s('Tax code or none'), account: s('Account'), project: s('Project'), department: s('Department') } },
  { name: 'docs.update-line', method: 'POST', fn: 'lib_docs.updateLine', perm: 'self', desc: 'Change one line.', params: { line: r('Line id'), item: s('Item'), description: s('Description'), qty: s('Quantity'), unit: s('Unit'), unit_price: s('Unit price'), discount: s('Discount %'), tax: s('Tax'), account: s('Account'), project: s('Project'), department: s('Department') } },
  { name: 'docs.remove-line', method: 'POST', fn: 'lib_docs.removeLine', perm: 'self', desc: 'Remove one line from a draft.', params: { line: r('Line id') } },
  {
    name: 'docs.post',
    method: 'POST',
    fn: 'lib_docs.post',
    perm: 'doc:full',
    agent: 'propose',
    preview: 'lib_docs.previewPost',
    desc: 'Post a delivery, invoice, credit note, goods receipt, bill or supplier credit: writes the journal entry and stock moves. From your AI agent this becomes a proposal a person approves.',
    params: { doc: r(DOC), date: s('Posting date (default the document date)'), due_date: s('Due date'), override_credit: b("Post even over the customer's credit limit") },
  },
  { name: 'docs.preview', method: 'GET', fn: 'lib_docs.previewPost', perm: 'self', desc: 'What posting would write (the journal lines), without posting.', params: { doc: r(DOC), date: s('Posting date') } },
  { name: 'docs.confirm', method: 'POST', fn: 'lib_docs.confirm', perm: 'self', desc: 'Confirm a draft order, or mark a draft quote as sent.', params: { doc: r(DOC) } },
  { name: 'docs.mark-sent', method: 'POST', fn: 'lib_docs.markSent', perm: 'self', desc: 'Record that the document was sent to the party.', params: { doc: r(DOC) } },
  { name: 'docs.accept', method: 'POST', fn: 'lib_docs.accept', perm: 'self', desc: 'Mark a quote accepted.', params: { doc: r(DOC) } },
  { name: 'docs.decline', method: 'POST', fn: 'lib_docs.decline', perm: 'self', desc: 'Mark a quote declined.', params: { doc: r(DOC) } },
  { name: 'docs.cancel', method: 'POST', fn: 'lib_docs.cancel', perm: 'self', desc: 'Cancel a quote or order that has nothing delivered or invoiced.', params: { doc: r(DOC) } },
  { name: 'docs.close', method: 'POST', fn: 'lib_docs.close', perm: 'self', desc: 'Close an order: the rest is not expected.', params: { doc: r(DOC) } },
  { name: 'docs.reopen', method: 'POST', fn: 'lib_docs.reopen', perm: 'self', desc: 'Reopen a closed or cancelled order, or a declined quote.', params: { doc: r(DOC) } },
  {
    name: 'docs.void',
    method: 'POST',
    fn: 'lib_docs.voidDoc',
    perm: 'doc:full',
    agent: 'propose',
    preview: 'lib_docs.previewVoid',
    desc: 'Void a posted document: reverses its journal entry and stock moves (payments must be removed first). From your AI agent this becomes a proposal.',
    params: { doc: r(DOC), reason: s('Why'), date: s('Date of the reversal (default: the original date, or the first open day)') },
  },
  { name: 'docs.preview-void', method: 'GET', fn: 'lib_docs.previewVoid', perm: 'self', desc: 'What voiding a posted document would reverse (the journal lines), without voiding.', params: { doc: r(DOC), reason: s('Why'), date: s('Date of the reversal') } },
  {
    name: 'docs.convert',
    method: 'POST',
    fn: 'lib_docs.convert',
    perm: 'self',
    desc: 'Make the next document from this one as a draft: quote to sales_order or invoice; order to delivery or invoice (goods_receipt or bill); delivery to invoice; receipt to bill; invoice to credit_note; bill to supplier_credit.',
    params: { doc: r(DOC), to: re('The new type', TYPES), lines: s('Pick quantities: [{"line":"<line id>","qty":2}] (default: everything still open)'), date: s('Date of the new document') },
  },
  { name: 'docs.duplicate', method: 'POST', fn: 'lib_docs.duplicate', perm: 'self', desc: 'Copy a document into a new draft.', params: { doc: r(DOC) } },
  { name: 'docs.delete', method: 'POST', fn: 'lib_docs.remove', perm: 'self', destructive: true, desc: 'Delete a draft (or a cancelled or declined quote or order). Posted documents are voided, never deleted.', params: { doc: r(DOC), preview: b('Only say what would happen') } },
  { name: 'docs.text', method: 'GET', fn: 'lib_docs.text', perm: 'self', desc: 'The document as text: recipient, subject and body for an email.', params: { doc: r(DOC) } },
];
