// services/bulkService.js
// Handles bulk messaging: file parsing, AI template generation (single call), and batch sending.

const XLSX = require('xlsx');
const path = require('path');
const fs = require('fs');
const logger = require('../utils/logger');
const config = require('../config');

// ── In-memory job state for progress tracking ──
let currentJob = null;

// ── File Parsing ──

/**
 * Normalize a header string to a consistent field key.
 * e.g. "Father's Name" → "father_name", "Math Marks" → "math_marks"
 */
function normalizeHeader(header) {
  return String(header || '')
    .trim()
    .toLowerCase()
    .replace(/[''`]/g, '')        // remove apostrophes
    .replace(/[^a-z0-9]+/g, '_') // non-alphanumeric → underscore
    .replace(/^_|_$/g, '');      // trim leading/trailing underscores
}

/**
 * Try to detect which column contains phone numbers.
 * Returns the normalized header key, or null.
 */
function detectPhoneColumn(headers) {
  const phonePatterns = ['phone', 'mobile', 'number', 'contact', 'whatsapp', 'cell', 'tel'];
  for (const h of headers) {
    const norm = normalizeHeader(h);
    if (phonePatterns.some(p => norm.includes(p))) return norm;
  }
  return null;
}

/**
 * Try to detect which column contains names.
 */
function detectNameColumn(headers) {
  const namePatterns = ['student_name', 'name', 'student'];
  for (const pattern of namePatterns) {
    for (const h of headers) {
      const norm = normalizeHeader(h);
      if (norm === pattern || norm.startsWith(pattern)) return norm;
    }
  }
  return null;
}

/**
 * Parse an uploaded Excel file (.xlsx / .xls).
 * Returns { headers: string[], normalizedHeaders: string[], rows: object[], phoneColumn, nameColumn }
 */
function parseExcelBuffer(buffer) {
  const workbook = XLSX.read(buffer, { type: 'buffer' });
  const sheetName = workbook.SheetNames[0];
  if (!sheetName) throw new Error('Excel file has no sheets');

  const sheet = workbook.Sheets[sheetName];
  const rawData = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });

  if (rawData.length < 2) throw new Error('File must have at least a header row and one data row');

  const headers = rawData[0].map(h => String(h).trim()).filter(Boolean);
  if (headers.length === 0) throw new Error('No headers detected in the first row');

  const normalizedHeaders = headers.map(normalizeHeader);
  const rows = [];

  for (let i = 1; i < rawData.length; i++) {
    const row = {};
    let hasData = false;
    for (let j = 0; j < headers.length; j++) {
      const val = rawData[i][j] !== undefined ? String(rawData[i][j]).trim() : '';
      row[normalizedHeaders[j]] = val;
      if (val) hasData = true;
    }
    if (hasData) rows.push(row);
  }

  return {
    headers,
    normalizedHeaders,
    rows,
    phoneColumn: detectPhoneColumn(headers),
    nameColumn: detectNameColumn(headers),
  };
}

/**
 * Parse a TXT/CSV file. Auto-detects delimiter (tab, comma, pipe, semicolon).
 */
function parseTextContent(content) {
  const lines = content.split(/\r?\n/).filter(l => l.trim());
  if (lines.length < 2) throw new Error('File must have at least a header row and one data row');

  // Detect delimiter
  const firstLine = lines[0];
  let delimiter = '\t';
  if (firstLine.includes('\t')) delimiter = '\t';
  else if (firstLine.includes('|')) delimiter = '|';
  else if (firstLine.includes(';')) delimiter = ';';
  else if (firstLine.includes(',')) delimiter = ',';

  const headers = firstLine.split(delimiter).map(h => h.trim()).filter(Boolean);
  if (headers.length === 0) throw new Error('No headers detected in the first line');

  const normalizedHeaders = headers.map(normalizeHeader);
  const rows = [];

  for (let i = 1; i < lines.length; i++) {
    const parts = lines[i].split(delimiter).map(p => p.trim());
    const row = {};
    let hasData = false;
    for (let j = 0; j < headers.length; j++) {
      const val = parts[j] || '';
      row[normalizedHeaders[j]] = val;
      if (val) hasData = true;
    }
    if (hasData) rows.push(row);
  }

  return {
    headers,
    normalizedHeaders,
    rows,
    phoneColumn: detectPhoneColumn(headers),
    nameColumn: detectNameColumn(headers),
  };
}

/**
 * Parse uploaded file (buffer + original filename).
 */
function parseFile(buffer, originalName) {
  const ext = path.extname(originalName).toLowerCase();
  if (ext === '.xlsx' || ext === '.xls') {
    return parseExcelBuffer(buffer);
  }
  if (ext === '.txt' || ext === '.csv') {
    return parseTextContent(buffer.toString('utf-8'));
  }
  throw new Error(`Unsupported file type: ${ext}. Please upload .xlsx, .xls, .txt, or .csv`);
}

// ── AI Template Generation ──

/**
 * Build the AI prompt for template generation.
 * Designed to use minimal tokens — one-shot, no conversation history.
 */
function buildTemplatePrompt(purpose, columns, sampleRow) {
  const fieldList = columns.map(c => `{{${c}}}`).join(', ');
  const samplePairs = columns.map(c => `${c}: "${sampleRow[c] || ''}"`).join(', ');

  return `You are a WhatsApp message template generator. Generate exactly ONE complete, detailed, and personalized WhatsApp message template.

PURPOSE: ${purpose}

AVAILABLE PLACEHOLDERS: ${fieldList}

SAMPLE DATA OF FIRST RECIPIENT:
${samplePairs}

RULES:
1. You MUST include and integrate ALL relevant data fields (placeholders) from the list above in the message, especially fields related to marks, scores, subjects, father's/parent's name, roll numbers, or status. Do NOT omit any information fields.
2. Format the message beautifully using WhatsApp markup:
   - Use *bold* for headers, labels, and key data fields (e.g., *Student Name:* {{name}}, *Father Name:* {{father_name}}).
   - Use bullet points or separate lines for listing subject marks/scores to make it clean and readable.
3. Keep the tone professional, polite, and warm.
4. Do NOT use generic greetings like "Dear Sir/Madam" if a name placeholder exists; greet using the placeholder (e.g., "Hello {{name}}").
5. Output ONLY the raw message template text. Do NOT wrap it in markdown code blocks, do NOT write quotes, and do NOT include any introduction, notes, explanation, or conversational filler. Output only the template itself.`;
}

/**
 * Generate a message template using a single AI call.
 * Uses the existing provider infrastructure to minimize code duplication.
 */
async function generateTemplate(purpose, columns, sampleRow) {
  const prompt = buildTemplatePrompt(purpose, columns, sampleRow);

  // Use the primary AI provider directly for a single one-shot call
  const primaryProvider = require('../providers');
  
  try {
    const template = await primaryProvider.generateReply({
      systemPrompt: 'You are a WhatsApp message template generator. Output ONLY the message template, nothing else.',
      history: [],
      userMessage: prompt,
      maxTokens: 2048, // Request higher limit to avoid truncation due to thinking tokens
    });
    return template.trim();
  } catch (err) {
    logger.error(`Template generation failed: ${err.message}`);
    throw new Error('Failed to generate message template. Please try again.');
  }
}

// ── Personalization ──

/**
 * Replace all {{placeholder}} tokens in the template with actual row data.
 */
function personalizeMessage(template, row) {
  return template.replace(/\{\{(\w+)\}\}/g, (match, key) => {
    return row[key] !== undefined ? row[key] : match;
  });
}

// ── Batch Sending ──

/**
 * Format a phone number for WhatsApp.
 * Strips non-digits, prepends country code if needed.
 */
function formatPhoneForWhatsApp(phone, countryCode = '91') {
  if (!phone) return null;
  let digits = String(phone).replace(/[^0-9]/g, '');
  if (!digits) return null;

  // Remove leading zeros
  digits = digits.replace(/^0+/, '');
  if (!digits) return null;

  // If already has country code (long enough), use as-is
  if (digits.length > 10) return digits;

  // Prepend country code
  return countryCode + digits;
}

/**
 * Start a bulk send job. Runs asynchronously and tracks progress.
 * @param {string} template - The message template with {{placeholders}}
 * @param {object[]} rows - Array of row data objects
 * @param {string} phoneColumn - Which column has the phone numbers
 * @param {string} countryCode - Default country code
 * @param {object} whatsappService - The whatsapp service instance
 * @returns {object} Job info
 */
async function startBulkSend(template, rows, phoneColumn, countryCode, whatsappService) {
  if (currentJob && currentJob.status === 'sending') {
    throw new Error('A bulk send job is already in progress. Please wait for it to finish.');
  }

  if (!phoneColumn) throw new Error('No phone number column specified');
  if (!rows || rows.length === 0) throw new Error('No data rows to send');

  currentJob = {
    status: 'sending',
    total: rows.length,
    sent: 0,
    failed: 0,
    errors: [],
    startedAt: Date.now(),
    completedAt: null,
  };

  // Run sending in background (don't await)
  _sendLoop(template, rows, phoneColumn, countryCode, whatsappService).catch(err => {
    logger.error(`Bulk send loop crashed: ${err.message}`);
    if (currentJob) {
      currentJob.status = 'error';
      currentJob.completedAt = Date.now();
    }
  });

  return { status: 'started', total: rows.length };
}

async function _sendLoop(template, rows, phoneColumn, countryCode, whatsappService) {
  const DELAY_BETWEEN_MESSAGES_MS = 3000; // 3 seconds between messages to avoid bans

  for (let i = 0; i < rows.length; i++) {
    if (!currentJob || currentJob.status !== 'sending') break;

    const row = rows[i];
    const rawPhone = row[phoneColumn];
    const formattedPhone = formatPhoneForWhatsApp(rawPhone, countryCode);

    if (!formattedPhone) {
      currentJob.failed += 1;
      currentJob.errors.push({ row: i + 1, error: `Invalid phone: "${rawPhone}"` });
      logger.warn(`Bulk send: Skipping row ${i + 1} — invalid phone "${rawPhone}"`);
      continue;
    }

    const message = personalizeMessage(template, row);

    try {
      await whatsappService.sendMessage(formattedPhone, message);
      currentJob.sent += 1;
      logger.info(`Bulk send: Sent ${currentJob.sent}/${currentJob.total} to ${formattedPhone}`);
    } catch (err) {
      currentJob.failed += 1;
      currentJob.errors.push({ row: i + 1, phone: formattedPhone, error: err.message });
      logger.error(`Bulk send: Failed to send to ${formattedPhone}: ${err.message}`);
    }

    // Delay between messages
    if (i < rows.length - 1) {
      await new Promise(resolve => setTimeout(resolve, DELAY_BETWEEN_MESSAGES_MS));
    }
  }

  if (currentJob) {
    currentJob.status = 'completed';
    currentJob.completedAt = Date.now();
    logger.info(`Bulk send completed: ${currentJob.sent} sent, ${currentJob.failed} failed out of ${currentJob.total}`);
  }
}

/**
 * Get the current job progress.
 */
function getProgress() {
  if (!currentJob) {
    return { status: 'idle', total: 0, sent: 0, failed: 0, errors: [] };
  }
  return { ...currentJob };
}

/**
 * Cancel a running bulk send job.
 */
function cancelJob() {
  if (currentJob && currentJob.status === 'sending') {
    currentJob.status = 'cancelled';
    currentJob.completedAt = Date.now();
    return true;
  }
  return false;
}

module.exports = {
  parseFile,
  generateTemplate,
  personalizeMessage,
  formatPhoneForWhatsApp,
  startBulkSend,
  getProgress,
  cancelJob,
};
