/**
 * Plain, self-contained transactional email bodies. All interpolated values
 * are HTML-escaped; nothing here links to internal hosts.
 */

export function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export interface RenderedEmail {
  subject: string;
  text: string;
  html: string;
}

const BRAND = '#0F7A4C';

function layout(title: string, bodyHtml: string): string {
  return `<!doctype html><html><body style="margin:0;background:#F4F6F5;font-family:Arial,Helvetica,sans-serif;color:#1B2420">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:24px 12px">
<table role="presentation" width="100%" style="max-width:560px;background:#fff;border-radius:10px;border:1px solid #E1E7E4">
<tr><td style="background:${BRAND};color:#fff;padding:18px 24px;border-radius:10px 10px 0 0;font-size:18px;font-weight:bold">GreenWave Recycling</td></tr>
<tr><td style="padding:24px"><h1 style="font-size:20px;margin:0 0 16px">${escapeHtml(title)}</h1>${bodyHtml}</td></tr>
<tr><td style="padding:16px 24px;border-top:1px solid #E1E7E4;font-size:12px;color:#5B6B64">Questions? Reply to this email or contact sales@greenwaverecycling.ca</td></tr>
</table></td></tr></table></body></html>`;
}

function row(label: string, value: string): string {
  return `<tr><td style="padding:6px 0;color:#5B6B64">${escapeHtml(label)}</td><td style="padding:6px 0;text-align:right;font-weight:bold">${escapeHtml(value)}</td></tr>`;
}

export function invoiceEmail(p: {
  invoiceNumber: string;
  customerName: string | null;
  totalDisplay: string;
  dueDate: string | null;
  payUrl: string | null;
  message: string | null;
}): RenderedEmail {
  const subject = `Invoice ${p.invoiceNumber} from GreenWave Recycling`;
  const lines = [
    p.customerName ? `Hello ${p.customerName},` : 'Hello,',
    '',
    p.message || 'Thank you for your business. Your invoice is attached.',
    '',
    `Invoice: ${p.invoiceNumber}`,
    `Amount due: ${p.totalDisplay}`,
    `Due date: ${p.dueDate || 'Upon receipt'}`,
  ];
  if (p.payUrl) lines.push('', `Pay securely online: ${p.payUrl}`);
  const button = p.payUrl
    ? `<p style="text-align:center;margin:24px 0"><a href="${escapeHtml(p.payUrl)}" style="background:${BRAND};color:#fff;text-decoration:none;padding:12px 22px;border-radius:6px;font-weight:bold;display:inline-block">Pay invoice online</a></p>`
    : '';
  const html = layout(
    `Invoice ${p.invoiceNumber}`,
    `<p>${escapeHtml(p.customerName ? `Hello ${p.customerName},` : 'Hello,')}</p>
<p>${escapeHtml(p.message || 'Thank you for your business. Your invoice is attached.')}</p>
<table role="presentation" width="100%">${row('Invoice', p.invoiceNumber)}${row('Amount due', p.totalDisplay)}${row('Due date', p.dueDate || 'Upon receipt')}</table>${button}`,
  );
  return { subject, text: lines.join('\n'), html };
}

export function paymentReceiptEmail(p: {
  invoiceNumber: string;
  customerName: string | null;
  amountDisplay: string;
  paymentReference: string;
  paidAt: string;
  methodDisplay: string | null;
}): RenderedEmail {
  const subject = `Payment received for invoice ${p.invoiceNumber}`;
  const fields: Array<[string, string]> = [
    ['Invoice', p.invoiceNumber],
    ['Amount paid', p.amountDisplay],
    ['Payment date', p.paidAt],
    ['Payment reference', p.paymentReference],
  ];
  if (p.methodDisplay) fields.push(['Payment method', p.methodDisplay]);
  const text = [
    p.customerName ? `Hello ${p.customerName},` : 'Hello,',
    '',
    'Thank you — we have received your payment.',
    '',
    ...fields.map(([k, v]) => `${k}: ${v}`),
  ].join('\n');
  const html = layout(
    'Payment received',
    `<p>${escapeHtml(p.customerName ? `Hello ${p.customerName},` : 'Hello,')}</p><p>Thank you — we have received your payment.</p>
<table role="presentation" width="100%">${fields.map(([k, v]) => row(k, v)).join('')}</table>`,
  );
  return { subject, text, html };
}

export function salesPaymentNotice(p: {
  invoiceNumber: string;
  customerName: string | null;
  amountDisplay: string;
  status: string;
  paymentReference: string;
  providerReference: string | null;
  paidAt: string;
  methodDisplay: string | null;
}): RenderedEmail {
  const subject = `[Payment ${p.status}] Invoice ${p.invoiceNumber} — ${p.amountDisplay}`;
  const fields: Array<[string, string]> = [
    ['Invoice', p.invoiceNumber],
    ['Customer', p.customerName || '—'],
    ['Amount', p.amountDisplay],
    ['Status', p.status],
    ['GreenWave payment ID', p.paymentReference],
    ['Stripe reference', p.providerReference || '—'],
    ['Date', p.paidAt],
    ['Method', p.methodDisplay || '—'],
  ];
  return {
    subject,
    text: fields.map(([k, v]) => `${k}: ${v}`).join('\n'),
    html: layout(`Payment ${p.status}`, `<table role="presentation" width="100%">${fields.map(([k, v]) => row(k, v)).join('')}</table>`),
  };
}

export function refundReceiptEmail(p: {
  invoiceNumber: string;
  customerName: string | null;
  amountDisplay: string;
  refundReference: string;
  refundedAt: string;
}): RenderedEmail {
  const subject = `Refund issued for invoice ${p.invoiceNumber}`;
  const fields: Array<[string, string]> = [
    ['Invoice', p.invoiceNumber],
    ['Refund amount', p.amountDisplay],
    ['Refund date', p.refundedAt],
    ['Refund reference', p.refundReference],
  ];
  const note = 'Refunds typically appear on your statement within 5–10 business days, depending on your bank.';
  return {
    subject,
    text: [p.customerName ? `Hello ${p.customerName},` : 'Hello,', '', 'A refund has been issued.', '', ...fields.map(([k, v]) => `${k}: ${v}`), '', note].join('\n'),
    html: layout(
      'Refund issued',
      `<p>${escapeHtml(p.customerName ? `Hello ${p.customerName},` : 'Hello,')}</p><p>A refund has been issued.</p><table role="presentation" width="100%">${fields.map(([k, v]) => row(k, v)).join('')}</table><p style="font-size:13px;color:#5B6B64">${escapeHtml(note)}</p>`,
    ),
  };
}
