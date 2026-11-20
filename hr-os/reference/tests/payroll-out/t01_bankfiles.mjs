// Byte-exact tests for lib_bankfiles.js (pure Node, no server).
// node tests/t01_bankfiles.mjs [path to pb_hooks]
import { createRequire } from 'node:module';
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const hooks = process.argv[2] || path.join(here, '..', 'app', 'pb', 'pb_hooks');
const require = createRequire(import.meta.url);
const B = require(path.join(hooks, 'lib_bankfiles.js'));

let pass = 0;
let fail = 0;
function ok(cond, name, extra) {
  if (cond) pass += 1;
  else {
    fail += 1;
    console.log('FAIL', name, extra === undefined ? '' : extra);
  }
}
function eq(a, b, name) {
  ok(a === b, name, a === b ? '' : '\n  got:  ' + JSON.stringify(a) + '\n  want: ' + JSON.stringify(b));
}
const sp = (n) => ' '.repeat(n);
const z = (n) => '0'.repeat(n);
const nodeSha = (bytes) => crypto.createHash('sha256').update(Buffer.from(bytes)).digest('hex');
const ascii = (bytes) => Buffer.from(bytes).toString('latin1');

/* ---------------------------------------------------------------- checks */
eq(B.routingValid('091000019'), true, 'routing 091000019 valid');
eq(B.routingValid('021000021'), true, 'routing 021000021 valid');
eq(B.routingValid('026009593'), true, 'routing 026009593 valid');
eq(B.routingValid('091000018'), false, 'routing 091000018 invalid');
eq(B.routingValid('09100001'), false, 'routing 8 digits invalid');
eq(B.ibanCheck('DE89 3704 0044 0532 0130 00').ok, true, 'IBAN DE valid with spaces');
eq(B.ibanCheck('GB82WEST12345698765432').ok, true, 'IBAN GB valid');
eq(B.ibanCheck('FR1420041010050500013M02606').ok, true, 'IBAN FR valid with letter');
eq(B.ibanCheck('NL91ABNA0417164300').ok, true, 'IBAN NL valid');
eq(B.ibanCheck('DE89370400440532013001').code, 'iban_check', 'IBAN wrong check digits');
eq(B.ibanCheck('DE8937040044053201300').code, 'iban_length', 'IBAN wrong length');
eq(B.ibanCheck('ZZ89370400440532013000').code, 'iban_country', 'IBAN unknown country');
eq(B.ibanCheck('1234').code, 'iban_shape', 'IBAN shape');
eq(B.bicValid('DEUTDEFF'), true, 'BIC 8');
eq(B.bicValid('DEUTDEFF500'), true, 'BIC 11');
eq(B.bicValid('DEUT1EFF'), false, 'BIC digit in country');
eq(B.bsbFormat('062000'), '062-000', 'BSB formatted');
eq(B.bsbFormat('062-000'), '062-000', 'BSB kept');
eq(B.bsbFormat('06200'), '', 'BSB 5 digits refused');
eq(B.ifscValid('HDFC0001234'), true, 'IFSC valid');
eq(B.ifscValid('HDFC1001234'), false, 'IFSC fifth char must be 0');
eq(B.sha256([]), 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855', 'sha256 empty');
eq(B.sha256(B.utf8Bytes('abc')), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad', 'sha256 abc');
const long = B.utf8Bytes('x'.repeat(1000) + '日本');
eq(B.sha256(long), nodeSha(long), 'sha256 long multi-block equals node crypto');
eq(B.majorText(123456, 2), '1234.56', 'major 2dp');
eq(B.majorText(5, 2), '0.05', 'major small');
eq(B.majorText(1500, 0), '1500', 'major 0dp');
eq(B.majorText(1, 3), '0.001', 'major 3dp');
eq(B.latinToAscii('Müller-Lüdenscheidt Ærøskøbing Łódź Șerban'), 'Muller-Ludenscheidt AEroskobing Lodz Serban', 'latin to ascii');

/* -------------------------------------------------------------- katakana */
eq(B.zenginKana('ヤマダ タロウ').text, 'ﾔﾏﾀﾞ ﾀﾛｳ', 'kana full-width with dakuten');
eq(B.zenginKana('さとう　はなこ').text, 'ｻﾄｳ ﾊﾅｺ', 'kana hiragana and ideographic space');
eq(B.zenginKana('キョウコ').text, 'ｷﾖｳｺ', 'small kana to large');
eq(B.zenginKana('ジョー').text, 'ｼﾞﾖ-', 'long vowel to hyphen');
eq(B.zenginKana('パク ヴィ').text, 'ﾊﾟｸ ｳﾞｲ', 'handakuten and vu');
eq(B.zenginKana('ｶﾌﾞｼｷｶﾞｲｼｬ (ｶ').text, 'ｶﾌﾞｼｷｶﾞｲｼｬ (ｶ'.replace('ｬ', 'ﾔ'), 'half-width input, small half-width to large');
eq(B.zenginKana('ｊｏｈｎ ｓｍｉｔｈ').text, 'JOHN SMITH', 'full-width latin to capitals');
eq(B.zenginKana('ヲ').text, 'ｦ', 'wo kept');
const kb = B.zenginKana('山田 太郎');
eq(kb.bad.join(''), '山田太郎', 'kanji refused');
eq(B.zenginKana('A&B').bad.join(''), '&', 'ampersand refused');
const jb = B.jisBytes('ｱﾞﾟｦﾔ A9');
eq(Buffer.from(jb).toString('hex'), 'b1dedfa6d4204139', 'JIS X 0201 bytes for kana');
{
  // Every Zengin character is one byte, and the dakuten split counts double.
  const k = B.zenginKana('ガ').text;
  eq(B.jisBytes(k).length, 2, 'ga is two bytes');
}

/* ------------------------------------------------------------- split pay */
{
  const r = B.splitNet(100000, [{ id: 'a', split: { kind: 'fixed', value: 20000 } }, { id: 'b', split: { kind: 'percent', value: 10 } }, { id: 'c', split: { kind: 'rest' } }]);
  eq(r.parts.map((x) => x.account.id + ':' + x.amount_minor).join(','), 'a:20000,b:10000,c:70000', 'split fixed+percent+rest');
  const r2 = B.splitNet(10000, [{ id: 'a', split: { kind: 'fixed', value: 15000 } }, { id: 'b', split: { kind: 'rest' } }]);
  eq(r2.parts.map((x) => x.account.id + ':' + x.amount_minor).join(','), 'a:10000', 'split fixed larger than net');
  eq(r2.warnings.indexOf('fixed_short') >= 0, true, 'split warns fixed short');
  const r3 = B.splitNet(1001, [{ id: 'a', split: { kind: 'percent', value: 33.3 } }, { id: 'b', split: { kind: 'percent', value: 50 } }]);
  eq(r3.parts.map((x) => x.account.id + ':' + x.amount_minor).join(','), 'a:501,b:500', 'split percent floor, rest to first when none marked');
  eq(r3.warnings.indexOf('no_rest_account') >= 0, true, 'split warns no rest');
  const r4 = B.splitNet(5000, [{ id: 'only', split: { kind: 'percent', value: 10 } }]);
  eq(r4.parts[0].amount_minor, 5000, 'split one account takes all');
  const tot = r.parts.reduce((a, x) => a + x.amount_minor, 0);
  eq(tot, 100000, 'split sums to net');
}

/* --------------------------------------------------------------- NACHA */
const created = '2026-11-04 09:30:00';
const nachaPayer = {
  destination_routing: '091000019', destination_name: 'Wells Fargo', origin: '1234567890', origin_name: 'Northwind Inc',
  company_name: 'Northwind Inc', company_id: '1234567890', odfi_routing: '091000019', entry_description: 'PAYROLL',
  account: '998877', account_type: 'checking',
};
const usPayments = [
  { ref: 'E0001', name: 'Alice Smith', bank_code: '021000021', account: '12345678', account_type: 'checking', amount_minor: 250000 },
  { ref: 'E0002', name: 'Bob Núñez', bank_code: '026009593', account: '9988776655', account_type: 'savings', amount_minor: 123456 },
];
{
  const r = B.write('nacha_ppd', { payer: nachaPayer, pay_date: '2026-11-06', created, reference: 'R12', currency: 'USD', payments: usPayments });
  eq(r.ok, true, 'nacha ok', r.problems);
  const lines = r.text.split('\n');
  eq(lines[lines.length - 1], '', 'nacha ends with a newline');
  lines.pop();
  eq(lines.length, 10, 'nacha blocked to 10 records');
  ok(lines.every((l) => l.length === 94), 'nacha every record 94 characters');
  const want = [
    '1' + '01' + ' 091000019' + '1234567890' + '261104' + '0930' + 'A' + '094' + '10' + '1' + 'WELLS FARGO' + sp(12) + 'NORTHWIND INC' + sp(10) + 'R12' + sp(5),
    '5' + '220' + 'NORTHWIND INC' + sp(3) + sp(20) + '1234567890' + 'PPD' + 'PAYROLL' + sp(3) + sp(6) + '261106' + sp(3) + '1' + '09100001' + '0000001',
    '6' + '22' + '02100002' + '1' + '12345678' + sp(9) + '0000250000' + 'E0001' + sp(10) + 'ALICE SMITH' + sp(11) + sp(2) + '0' + '09100001' + '0000001',
    '6' + '32' + '02600959' + '3' + '9988776655' + sp(7) + '0000123456' + 'E0002' + sp(10) + 'BOB NUNEZ' + sp(13) + sp(2) + '0' + '09100001' + '0000002',
    '8' + '220' + '000002' + '0004700961' + z(12) + '000000373456' + '1234567890' + sp(19) + sp(6) + '09100001' + '0000001',
    '9' + '000001' + '000001' + '00000002' + '0004700961' + z(12) + '000000373456' + sp(39),
  ];
  for (let i = 0; i < want.length; i++) eq(lines[i], want[i], 'nacha record ' + (i + 1));
  for (let i = 6; i < 10; i++) eq(lines[i], '9'.repeat(94), 'nacha filler ' + i);
  // positions per the Nacha layout (1-based)
  eq(lines[2].slice(3, 11), '02100002', 'entry RDFI at 4-11');
  eq(lines[2].slice(11, 12), '1', 'entry check digit at 12');
  eq(lines[2].slice(29, 39), '0000250000', 'entry amount at 30-39');
  eq(lines[2].slice(79, 94), '091000010000001', 'entry trace at 80-94');
  eq(lines[4].slice(10, 20), '0004700961', 'batch entry hash at 11-20 (02100002 + 02600959)');
  eq(lines[5].slice(7, 13), '000001', 'file block count at 8-13');
  eq(r.control.entry_hash, '0004700961', 'control entry hash');
  eq(r.total_minor, 373456, 'nacha total');
  eq(r.count, 2, 'nacha count');
  eq(r.sha256, nodeSha(r.bytes), 'nacha sha256 equals node crypto');
  eq(r.filename, 'nacha_ppd-2026-11-06.ach', 'nacha filename');
  ok(r.warnings.some((w) => w.code === 'name_changed' && w.ref === 'E0002'), 'nacha warns about the changed name');
}
{
  // Offset debit: service class 200, entry hash includes the ODFI, debit equals credit.
  const r = B.write('nacha_ppd', { payer: nachaPayer, pay_date: '2026-11-06', created, reference: 'R12', currency: 'USD', payments: usPayments, options: { offset: true, newline: 'crlf' } });
  eq(r.ok, true, 'nacha offset ok');
  const lines = r.text.split('\r\n');
  lines.pop();
  eq(lines[1].slice(1, 4), '200', 'offset batch service class 200');
  eq(lines[4], '6' + '27' + '09100001' + '9' + '998877' + sp(11) + '0000373456' + 'OFFSET' + sp(9) + 'NORTHWIND INC' + sp(9) + sp(2) + '0' + '09100001' + '0000003', 'offset entry record');
  eq(lines[5].slice(10, 20), '0013800962', 'offset entry hash adds ODFI 09100001');
  eq(lines[5].slice(20, 32), '000000373456', 'offset total debit');
  eq(lines[6].slice(13, 21), '00000003', 'offset file entry count');
}
{
  // Twelve entries make 16 records: two blocks, 4 fillers.
  const many = [];
  for (let i = 0; i < 12; i++) many.push({ ref: 'E' + (100 + i), name: 'Person ' + i, bank_code: '011000015', account: String(1000 + i), account_type: 'checking', amount_minor: 1000 + i });
  const r = B.write('nacha_ppd', { payer: nachaPayer, pay_date: '2026-11-06', created, reference: 'R13', currency: 'USD', payments: many });
  const lines = r.text.split('\n');
  lines.pop();
  eq(lines.length, 20, 'nacha 16 records pad to 20');
  eq(lines[15].slice(7, 13), '000002', 'nacha block count 2');
  eq(lines[14].slice(10, 20), right10(12 * 1100001), 'nacha hash of 12 entries');
  eq(lines[16], '9'.repeat(94), 'nacha filler after control');
  const sum = many.reduce((a, p) => a + p.amount_minor, 0);
  eq(lines[15].slice(43, 55), String(sum).padStart(12, '0'), 'nacha file credit total');
}
function right10(n) { return String(n % 10000000000).padStart(10, '0'); }
{
  // Entry hash keeps the rightmost 10 digits.
  const many = [];
  for (let i = 0; i < 130; i++) many.push({ ref: 'E' + i, name: 'P ' + i, bank_code: '991000009', account: '1', account_type: 'checking', amount_minor: 1 });
  ok(B.routingValid('991000009'), 'routing 991000004 valid for the overflow test');
  const r = B.write('nacha_ppd', { payer: nachaPayer, pay_date: '2026-11-06', created, reference: 'R', currency: 'USD', payments: many });
  eq(r.control.entry_hash, right10(130 * 99100000), 'entry hash overflow keeps 10 digits');
  eq(String(130 * 99100000).length, 11, 'overflow case really has 11 digits');
}
{
  const bad = [
    { ref: 'E1', name: 'A', bank_code: '091000018', account: '1', account_type: 'checking', amount_minor: 100 },
    { ref: 'E2', name: '山田', bank_code: '091000019', account: '', account_type: 'loan', amount_minor: 0 },
  ];
  const r = B.write('nacha_ppd', { payer: nachaPayer, pay_date: '2026-11-06', created, reference: 'R', currency: 'USD', payments: bad });
  eq(r.ok, false, 'nacha refuses bad data');
  eq(r.bytes.length, 0, 'nacha no bytes on problems');
  const codes = r.problems.map((p) => p.ref + ':' + p.code).sort().join(',');
  eq(codes, 'E1:routing_check,E2:account_shape,E2:account_type,E2:amount_zero,E2:name_charset', 'nacha problems per employee');
  const p2 = B.write('nacha_ppd', { payer: { ...nachaPayer, company_id: '' }, pay_date: '2026-11-06', created, currency: 'USD', payments: usPayments });
  eq(p2.problems[0].field, 'payer.company_id', 'nacha payer field missing');
  const p3 = B.write('nacha_ppd', { payer: nachaPayer, pay_date: '2026-11-06', created, currency: 'EUR', payments: usPayments });
  eq(p3.problems[0].code, 'currency_mismatch', 'nacha refuses EUR');
  ok(!JSON.stringify(r.problems).includes('9988776655'), 'problems never carry a full account number');
}

/* ----------------------------------------------------------------- ABA */
const abaPayer = { fi: 'CBA', user_name: 'Northwind Pty Ltd', user_id: '301500', bsb: '062-000', account: '12345678', remitter: 'NORTHWIND PAY', description: 'PAYROLL', account_title: 'Northwind Pty Ltd' };
const auPayments = [
  { ref: 'E0101', name: 'Charlotte O\'Brien', bank_code: '082-001', account: '87654321', amount_minor: 312550, reference: 'PAY NOV 2026' },
  { ref: 'E0102', name: 'Liam Nguyen', bank_code: '062', branch_code: '905', account: '1234', amount_minor: 99 },
];
{
  const r = B.write('aba', { payer: abaPayer, pay_date: '2026-11-13', created, reference: 'NOV 2026', currency: 'AUD', payments: auPayments });
  eq(r.ok, true, 'aba ok', r.problems);
  const lines = r.text.split('\r\n');
  eq(lines.pop(), '', 'aba ends with CRLF');
  eq(lines.length, 4, 'aba 4 records');
  ok(lines.every((l) => l.length === 120), 'aba every record 120 characters');
  const want = [
    '0' + sp(17) + '01' + 'CBA' + sp(7) + 'NORTHWIND PTY LTD' + sp(9) + '301500' + 'PAYROLL' + sp(5) + '131126' + sp(40),
    '1' + '082-001' + ' 87654321' + ' ' + '53' + '0000312550' + "CHARLOTTE O'BRIEN" + sp(15) + 'PAY NOV 2026' + sp(6) + '062-000' + ' 12345678' + 'NORTHWIND PAY' + sp(3) + '00000000',
    '1' + '062-905' + '     1234' + ' ' + '53' + '0000000099' + 'LIAM NGUYEN' + sp(21) + 'NOV 2026' + sp(10) + '062-000' + ' 12345678' + 'NORTHWIND PAY' + sp(3) + '00000000',
    '7' + '999-999' + sp(12) + '0000312649' + '0000312649' + '0000000000' + sp(24) + '000002' + sp(40),
  ];
  for (let i = 0; i < want.length; i++) eq(lines[i], want[i], 'aba record ' + i);
  eq(lines[1].slice(1, 8), '082-001', 'aba BSB at 2-8');
  eq(lines[1].slice(18, 20), '53', 'aba transaction code at 19-20');
  eq(lines[3].slice(74, 80), '000002', 'aba count at 75-80');
  eq(r.sha256, nodeSha(r.bytes), 'aba sha256');
}
{
  const r = B.write('aba', { payer: abaPayer, pay_date: '2026-11-13', created, reference: 'NOV 2026', currency: 'AUD', payments: auPayments, options: { balance: true } });
  const lines = r.text.split('\r\n');
  lines.pop();
  eq(lines[3], '1' + '062-000' + ' 12345678' + ' ' + '13' + '0000312649' + 'NORTHWIND PTY LTD' + sp(15) + 'NOV 2026' + sp(10) + '062-000' + ' 12345678' + 'NORTHWIND PAY' + sp(3) + '00000000', 'aba balancing debit record');
  eq(lines[4], '7' + '999-999' + sp(12) + '0000000000' + '0000312649' + '0000312649' + sp(24) + '000003' + sp(40), 'aba balanced total: net zero, count 3');
}
{
  const r = B.write('aba', { payer: abaPayer, pay_date: '2026-11-13', created, currency: 'AUD', payments: [{ ref: 'X', name: 'A', bank_code: '0620', account: '0000', amount_minor: 5 }] });
  eq(r.problems.map((p) => p.code).sort().join(','), 'account_shape,bsb_shape', 'aba bsb and zero account refused');
}

/* ---------------------------------------------------------------- SEPA */
{
  const r = B.write('sepa_pain001', {
    payer: { name: 'Northwind GmbH', iban: 'DE89 3704 0044 0532 0130 00', bic: 'COBADEFFXXX' }, pay_date: '2026-11-27', created: '2026-11-04 09:30:00', reference: 'R2026-11',
    currency: 'EUR', payments: [
      { ref: 'E0201', name: 'Jürgen Groß & Söhne', iban: 'FR1420041010050500013M02606', bic: 'PSSTFRPPXXX', amount_minor: 350075, reference: 'Salary November 2026' },
      { ref: 'E0202', name: 'Anna de Vries', iban: 'NL91ABNA0417164300', amount_minor: 10 },
    ],
  });
  eq(r.ok, true, 'sepa ok', r.problems);
  const want = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<Document xmlns="urn:iso:std:iso:20022:tech:xsd:pain.001.001.03" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">',
    '  <CstmrCdtTrfInitn>',
    '    <GrpHdr>',
    '      <MsgId>R2026-11-20261104093000</MsgId>',
    '      <CreDtTm>2026-11-04T09:30:00</CreDtTm>',
    '      <NbOfTxs>2</NbOfTxs>',
    '      <CtrlSum>3500.85</CtrlSum>',
    '      <InitgPty>',
    '        <Nm>Northwind GmbH</Nm>',
    '      </InitgPty>',
    '    </GrpHdr>',
    '    <PmtInf>',
    '      <PmtInfId>R2026-11-20261104093000</PmtInfId>',
    '      <PmtMtd>TRF</PmtMtd>',
    '      <BtchBookg>true</BtchBookg>',
    '      <NbOfTxs>2</NbOfTxs>',
    '      <CtrlSum>3500.85</CtrlSum>',
    '      <PmtTpInf>',
    '        <SvcLvl>',
    '          <Cd>SEPA</Cd>',
    '        </SvcLvl>',
    '        <CtgyPurp>',
    '          <Cd>SALA</Cd>',
    '        </CtgyPurp>',
    '      </PmtTpInf>',
    '      <ReqdExctnDt>2026-11-27</ReqdExctnDt>',
    '      <Dbtr>',
    '        <Nm>Northwind GmbH</Nm>',
    '      </Dbtr>',
    '      <DbtrAcct>',
    '        <Id>',
    '          <IBAN>DE89370400440532013000</IBAN>',
    '        </Id>',
    '      </DbtrAcct>',
    '      <DbtrAgt>',
    '        <FinInstnId>',
    '          <BIC>COBADEFFXXX</BIC>',
    '        </FinInstnId>',
    '      </DbtrAgt>',
    '      <ChrgBr>SLEV</ChrgBr>',
    '      <CdtTrfTxInf>',
    '        <PmtId>',
    '          <EndToEndId>R2026-11-E0201</EndToEndId>',
    '        </PmtId>',
    '        <Amt>',
    '          <InstdAmt Ccy="EUR">3500.75</InstdAmt>',
    '        </Amt>',
    '        <CdtrAgt>',
    '          <FinInstnId>',
    '            <BIC>PSSTFRPPXXX</BIC>',
    '          </FinInstnId>',
    '        </CdtrAgt>',
    '        <Cdtr>',
    '          <Nm>Jurgen Gross Sohne</Nm>',
    '        </Cdtr>',
    '        <CdtrAcct>',
    '          <Id>',
    '            <IBAN>FR1420041010050500013M02606</IBAN>',
    '          </Id>',
    '        </CdtrAcct>',
    '        <RmtInf>',
    '          <Ustrd>Salary November 2026</Ustrd>',
    '        </RmtInf>',
    '      </CdtTrfTxInf>',
    '      <CdtTrfTxInf>',
    '        <PmtId>',
    '          <EndToEndId>R2026-11-E0202</EndToEndId>',
    '        </PmtId>',
    '        <Amt>',
    '          <InstdAmt Ccy="EUR">0.10</InstdAmt>',
    '        </Amt>',
    '        <Cdtr>',
    '          <Nm>Anna de Vries</Nm>',
    '        </Cdtr>',
    '        <CdtrAcct>',
    '          <Id>',
    '            <IBAN>NL91ABNA0417164300</IBAN>',
    '          </Id>',
    '        </CdtrAcct>',
    '        <RmtInf>',
    '          <Ustrd>R2026-11</Ustrd>',
    '        </RmtInf>',
    '      </CdtTrfTxInf>',
    '    </PmtInf>',
    '  </CstmrCdtTrfInitn>',
    '</Document>',
    '',
  ].join('\n');
  eq(r.text, want, 'sepa xml byte-exact');
  eq(Buffer.from(r.bytes).toString('utf8'), want, 'sepa bytes are the UTF-8 text');
  eq(r.total_minor, 350085, 'sepa total');
  ok(r.warnings.some((w) => w.ref === 'E0201' && w.code === 'name_changed'), 'sepa warns about name transliteration');
}
{
  const r = B.write('sepa_pain001', {
    payer: { name: 'X', iban: 'DE89370400440532013000' }, pay_date: '2026-11-27', created, reference: 'R', currency: 'EUR',
    payments: [{ ref: 'A', name: 'A', iban: 'DE89370400440532013001', amount_minor: 1 }, { ref: 'B', name: 'B', iban: 'AE070331234567890123456', amount_minor: 1 }, { ref: 'C', name: 'C', iban: '', amount_minor: 1 }],
  });
  eq(r.problems.map((p) => p.ref + ':' + p.code).join(','), 'A:iban_check,B:iban_not_sepa,C:iban_missing', 'sepa iban problems');
  const r2 = B.write('sepa_pain001', { payer: { name: 'X', iban: 'DE89370400440532013000' }, pay_date: '2026-11-27', created, reference: 'R', currency: 'EUR', payments: [{ ref: 'A', name: 'A', iban: 'NL91ABNA0417164300', amount_minor: 1 }] });
  ok(r2.text.includes('<Othr>\n            <Id>NOTPROVIDED</Id>'), 'sepa debtor agent NOTPROVIDED without BIC');
}

/* ---------------------------------------------------------------- Bacs */
{
  const r = B.write('bacs_csv', { pay_date: '2026-11-27', created, reference: 'SALARY NOV', currency: 'GBP', payments: [
    { ref: 'E0301', name: 'Siobhán O\'Neill', bank_code: '20-00-00', account: '55779911', amount_minor: 210050 },
    { ref: 'E0302', name: 'Raj Patel', bank_code: '401276', account: '1234 5678', amount_minor: 99999, reference: 'NOV PAY' },
  ] });
  eq(r.ok, true, 'bacs ok', r.problems);
  eq(r.text, '200000,55779911,SIOBHAN ONEILL,2100.50,SALARY NOV\r\n401276,12345678,RAJ PATEL,999.99,NOV PAY\r\n', 'bacs csv byte-exact');
  ok(r.warnings.some((w) => w.code === 'reference_short' && w.ref === 'E0302') === false, 'bacs 6 char reference fine');
  const r2 = B.write('bacs_csv', { pay_date: '2026-11-27', created, currency: 'GBP', payments: [{ ref: 'X', name: 'A', bank_code: '2000', account: '1234567', amount_minor: 1 }] });
  eq(r2.problems.map((p) => p.code).sort().join(','), 'account_shape,sort_code_shape', 'bacs shapes');
  eq(r.official, false, 'bacs is marked as not a published layout (the screens tag it check with your bank)');
}

/* -------------------------------------------------------------- Zengin */
const jpPayer = { consignor_code: '1234567890', consignor_kana: 'カ）ノースウインド', bank_code: '0005', bank_kana: 'ミツビシユーエフジエイ', branch_code: '001', branch_kana: 'トウキヨウ', account_type: 'ordinary', account: '1234567' };
const jpPayments = [
  { ref: 'E0401', name: '山田 太郎', kana: 'ヤマダ タロウ', bank_code: '0001', branch_code: '100', account: '7654321', account_type: 'ordinary', amount_minor: 312000 },
  { ref: 'E0402', name: '佐藤 京子', kana: 'さとう きょうこ', bank_code: '0009', branch_code: '015', account: '12345', account_type: 'current', amount_minor: 2500 },
];
{
  const r = B.write('zengin', { payer: jpPayer, pay_date: '2026-11-25', created, reference: '2026-11', currency: 'JPY', kind: 'salary', payments: jpPayments });
  eq(r.ok, true, 'zengin ok', r.problems);
  eq(r.encoding, 'shift_jis', 'zengin encoding');
  eq(r.bytes.length, 5 * 122, 'zengin 5 records of 120 bytes plus CRLF');
  const recs = [];
  for (let i = 0; i < 5; i++) {
    recs.push(r.bytes.slice(i * 122, i * 122 + 120));
    eq(r.bytes[i * 122 + 120] === 13 && r.bytes[i * 122 + 121] === 10, true, 'zengin CRLF after record ' + i);
  }
  ok(recs.every((x) => x.length === 120), 'zengin records 120 bytes');
  const J = (t) => Buffer.from(B.jisBytes(t));
  const wantHead = Buffer.concat([J('1' + '11' + '0' + '1234567890'), J('ｶ)ﾉ-ｽｳｲﾝﾄﾞ'), J(sp(40 - 10)), J('1125' + '0005'), J('ﾐﾂﾋﾞｼﾕ-ｴﾌｼﾞｴｲ'), J(sp(15 - 13)), J('001'), J('ﾄｳｷﾖｳ' + sp(10)), J('1' + '1234567' + sp(17))]);
  eq(Buffer.from(recs[0]).toString('hex'), wantHead.toString('hex'), 'zengin header bytes');
  const wantD1 = Buffer.concat([J('2' + '0001' + sp(15) + '100' + sp(15) + '0000' + '1' + '7654321'), J('ﾔﾏﾀﾞ ﾀﾛｳ' + sp(30 - 8)), J('0000312000' + '0' + sp(10) + sp(10) + sp(9))]);
  eq(Buffer.from(recs[1]).toString('hex'), wantD1.toString('hex'), 'zengin data 1 bytes');
  const wantD2 = Buffer.concat([J('2' + '0009' + sp(15) + '015' + sp(15) + '0000' + '2' + '0012345'), J('ｻﾄｳ ｷﾖｳｺ' + sp(30 - 8)), J('0000002500' + '0' + sp(29))]);
  eq(Buffer.from(recs[2]).toString('hex'), wantD2.toString('hex'), 'zengin data 2 bytes');
  eq(ascii(recs[3]), '8' + '000002' + '000000314500' + sp(101), 'zengin trailer count and total');
  eq(ascii(recs[4]), '9' + sp(119), 'zengin end record');
  eq(recs[1][0], 0x32, 'zengin data record starts with 2');
  eq(r.sha256, nodeSha(r.bytes), 'zengin sha256');
}
{
  // Header, data, trailer and end with the end record checked, bonus type, no separators, EOF byte.
  const r = B.write('zengin', { payer: jpPayer, pay_date: '2026-12-10', created, reference: 'B', currency: 'JPY', kind: 'bonus', payments: [jpPayments[0]], options: { newline: 'none', eof: true, employee_codes: true } });
  eq(r.bytes.length, 4 * 120 + 1, 'zengin no separators plus EOF');
  eq(r.bytes[480], 0x1a, 'zengin EOF byte');
  eq(ascii(r.bytes.slice(0, 3)), '112', 'zengin bonus type 12');
  eq(ascii(r.bytes.slice(360, 480)), '9' + sp(119), 'zengin end record');
  eq(ascii(r.bytes.slice(120 + 91, 120 + 101)), '0000000401', 'zengin employee code digits right aligned');
}
{
  const r = B.write('zengin', { payer: jpPayer, pay_date: '2026-11-25', created, reference: 'R', currency: 'JPY', payments: [
    { ref: 'A', name: '山田 太郎', kana: '', bank_code: '1', branch_code: '1000', account: '12345678', account_type: 'x', amount_minor: 0 },
  ] });
  eq(r.problems.map((p) => p.code).sort().join(','), 'account_shape,account_type,amount_zero,bank_code_shape,branch_code_shape,kana_charset', 'zengin problems');
  const r2 = B.write('zengin', { payer: jpPayer, pay_date: '2026-11-25', created, reference: 'R', currency: 'JPY', payments: [
    { ref: 'A', name: 'x', kana: 'アイウエオカキクケコサシスセソタチツテトナニヌネノハヒフヘホマミムメモ', bank_code: '0001', branch_code: '100', account: '1', account_type: 'ordinary', amount_minor: 1 },
  ] });
  eq(r2.ok, true, 'zengin long kana still writes');
  ok(r2.warnings.some((w) => w.code === 'kana_cut'), 'zengin warns kana cut to 30');
  eq(r2.bytes.length, 488, 'zengin long kana record still 120');
}

/* ---------------------------------------------------------- SG, IN, MY */
{
  const r = B.write('sg_giro_csv', { pay_date: '2026-11-28', created, reference: 'NOV26', currency: 'SGD', payments: [
    { ref: 'E0501', name: 'Tan Wei Ling', bank_code: '7171', branch_code: '081', account: '0123456789', amount_minor: 512300 },
    { ref: 'E0502', name: 'Kumar', bic: 'OCBCSGSG', account: '501234567001', amount_minor: 100 },
  ] });
  eq(r.ok, true, 'sg ok', r.problems);
  eq(r.text, 'name,bank_code,branch_code,account_number,amount,purpose_code,reference,employee_number\r\n' +
    '"TAN WEI LING","7171","081","0123456789",5123.00,SALA,"NOV26","E0501"\r\n' +
    '"KUMAR","OCBCSGSG","","501234567001",1.00,SALA,"NOV26","E0502"\r\n', 'sg giro csv byte-exact');
}
{
  const r = B.write('in_neft_csv', { pay_date: '2026-11-30', created, reference: 'SALARY NOV 2026', currency: 'INR', payments: [
    { ref: 'E0601', name: 'Priya Sharma', bank_code: 'HDFC0001234', account: '50100012345678', amount_minor: 8500050, email: 'priya@example.com' },
  ] });
  eq(r.text, 'beneficiary_name,account_number,ifsc,amount,payment_mode,narration,employee_number,email\r\n' +
    '"PRIYA SHARMA","50100012345678","HDFC0001234",85000.50,NEFT,"SALARY NOV 2026","E0601","priya@example.com"\r\n', 'in neft csv byte-exact');
  const r2 = B.write('in_neft_csv', { pay_date: '2026-11-30', created, currency: 'INR', payments: [{ ref: 'X', name: 'A', bank_code: 'HDFC1234', account: '12', amount_minor: 1 }] });
  eq(r2.problems.map((p) => p.code).sort().join(','), 'account_shape,ifsc_shape', 'in neft problems');
}
{
  const pays = [{ ref: 'E0701', name: 'Nur Aisyah binti Ahmad', bic: 'MBBEMYKL', account: '512345678901', id_type: 'nric', id_number: '900101-14-5678', amount_minor: 450000, email: 'nur@example.com' }];
  const r = B.write('my_maybank_csv', { pay_date: '2026-11-25', created, reference: 'GAJI NOV 2026', currency: 'MYR', payments: pays });
  eq(r.text, 'Beneficiary Name,Beneficiary Bank,Beneficiary Account No,ID Type,ID Number,Payment Amount,Payment Reference,Payment Description,Beneficiary Email,Crediting Date\r\n' +
    '"NUR AISYAH BINTI AHMAD","MBBEMYKL","512345678901","NRIC","900101145678",4500.00,"GAJI NOV 2026","SALARY","nur@example.com","25/11/2026"\r\n', 'maybank csv byte-exact');
  const c = B.write('my_cimb_txt', { payer: { name: 'Northwind Sdn Bhd', account: '8001234567' }, pay_date: '2026-11-25', created, reference: 'GAJI NOV 2026', currency: 'MYR', payments: pays });
  eq(c.text, 'H|NORTHWIND SDN BHD|8001234567|20261125|1|4500.00\r\n' +
    'D|NUR AISYAH BINTI AHMAD|MBBEMYKL|512345678901|NRIC|900101145678|4500.00|GAJI NOV 2026|SALARY|nur@example.com\r\n' +
    'T|1|4500.00\r\n', 'cimb txt byte-exact');
  const bad = B.write('my_maybank_csv', { pay_date: '2026-11-25', created, currency: 'MYR', payments: [{ ref: 'X', name: 'A', bic: 'MBB', account: '12', id_type: 'nric', id_number: '123', amount_minor: 1 }] });
  eq(bad.problems.map((p) => p.code).sort().join(','), 'account_shape,bic_shape,id_shape', 'maybank problems');
}

/* ------------------------------------------------------------- generic */
{
  const r = B.write('generic_csv', { pay_date: '2026-11-25', created, reference: 'Run 7', currency: 'KWD', payments: [
    { ref: 'E1', name: '=HYPERLINK("x")', bank_name: 'Bank, "Main"', bank_code: '01', branch_code: '', account: '000123', iban: '', bic: 'nbokkwkw', amount_minor: 1234567 },
  ] });
  eq(r.text, 'employee_number,name,bank_name,bank_code,branch_code,account_number,iban,swift,amount,currency,reference\r\n' +
    'E1,"\'=HYPERLINK(""x"")","Bank, ""Main""","01","","000123","","NBOKKWKW",1234.567,KWD,Run 7\r\n', 'generic csv byte-exact with 3 decimals and formula guard');
  const r2 = B.write('generic_csv', { pay_date: '2026-11-25', created, currency: '', payments: [{ ref: 'A', name: 'A', account: '1', amount_minor: 1 }] });
  eq(r2.problems[0].code, 'currency_missing', 'generic needs a currency');
}
{
  const r = B.write('nope', {});
  eq(r.problems[0].code, 'format_unknown', 'unknown format');
  const r2 = B.write('aba', { payer: abaPayer, pay_date: '2026-11-13', created, currency: 'AUD', payments: [] });
  eq(r2.problems[0].code, 'no_payments', 'empty payments refused');
  eq(B.list().length, 10, 'ten formats listed');
  ok(B.list().every((f) => typeof f.official === 'boolean' && f.label && f.layout), 'formats carry label and layout');
  eq(B.list().filter((f) => !f.official).map((f) => f.code).join(','), 'generic_csv,bacs_csv,sg_giro_csv,in_neft_csv,my_maybank_csv,my_cimb_txt', 'the formats with no published layout');
}

console.log(`bankfiles: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
