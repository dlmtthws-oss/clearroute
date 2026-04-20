import { useState, useCallback, useRef } from 'react';
import { Link } from 'react-router-dom';
import Papa from 'papaparse';
import * as XLSX from 'xlsx';
import { supabase } from '../lib/supabase';

// ─── Field definitions ───────────────────────────────────────────────────────

const FIELDS = [
  { key: 'name',           label: 'Customer Name', required: true },
  { key: 'address_line_1', label: 'Address Line 1', required: true },
  { key: 'address_line_2', label: 'Address Line 2', required: false },
  { key: 'city',           label: 'City',           required: false },
  { key: 'postcode',       label: 'Postcode',        required: false },
  { key: 'email',          label: 'Email Address',  required: false },
  { key: 'phone',          label: 'Phone Number',   required: false },
  { key: 'service_type',   label: 'Service Type',   required: false },
  { key: 'notes',          label: 'Notes',          required: false },
];

const AUTO_DETECT = {
  name:           ['name', 'customer name', 'full name', 'customer', 'client name', 'client'],
  address_line_1: ['address', 'address line 1', 'address1', 'street', 'street address', 'addr'],
  address_line_2: ['address line 2', 'address2', 'addr2'],
  city:           ['city', 'town'],
  postcode:       ['postcode', 'post code', 'zip', 'zip code', 'postal code', 'post_code'],
  email:          ['email', 'email address', 'e-mail', 'email_address'],
  phone:          ['phone', 'mobile', 'telephone', 'phone number', 'mobile number', 'tel', 'cell'],
  service_type:   ['service type', 'service', 'type', 'service_type'],
  notes:          ['notes', 'note', 'comments', 'comment', 'additional info'],
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

function buildAutoMapping(headers) {
  const normalized = headers.map(h => h.toLowerCase().trim());
  const mapping = {};
  FIELDS.forEach(field => {
    const match = normalized.find(h => AUTO_DETECT[field.key].includes(h));
    mapping[field.key] = match ? headers[normalized.indexOf(match)] : '__skip__';
  });
  return mapping;
}

function getMappedValue(rawRow, headers, mapping, fieldKey) {
  const header = mapping[fieldKey];
  if (!header || header === '__skip__') return '';
  const idx = headers.indexOf(header);
  return idx === -1 ? '' : String(rawRow[idx] ?? '').trim();
}

function mapRow(rawRow, headers, mapping) {
  const out = {};
  FIELDS.forEach(f => { out[f.key] = getMappedValue(rawRow, headers, mapping, f.key); });
  if (out.postcode) out.postcode = out.postcode.toUpperCase().trim();
  return out;
}

function validateMappedRow(row) {
  return FIELDS.filter(f => f.required && !row[f.key]).map(f => `Missing ${f.label}`);
}

function downloadTemplate() {
  const rows = [
    FIELDS.map(f => f.label),
    ['John Smith', '123 High Street', 'Flat 2', 'Manchester', 'M1 1AB', 'john@example.com', '07700900123', 'Monthly', 'Ground floor only'],
    ['Jane Doe',   '45 Oak Avenue',   '',       'Birmingham', 'B2 4CD', 'jane@example.com', '07700900456', 'Weekly',  ''],
  ];
  const csv = rows.map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n');
  triggerDownload(csv, 'clearroute_import_template.csv', 'text/csv');
}

function downloadErrorReport(errors, validRows) {
  const header = ['Row Number', 'Customer Name', 'Address Line 1', 'Postcode', 'Error'];
  const rows = errors.map(e => {
    const r = validRows.find(v => v.idx === e.idx)?.data ?? {};
    return [e.idx + 2, r.name ?? '', r.address_line_1 ?? '', r.postcode ?? '', e.reason];
  });
  const csv = [header, ...rows].map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n');
  triggerDownload(csv, 'import_errors.csv', 'text/csv');
}

function triggerDownload(content, filename, type) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click();
  document.body.removeChild(a); URL.revokeObjectURL(url);
}

// ─── Main component ──────────────────────────────────────────────────────────

export default function CustomerImportPage() {
  const fileInputRef = useRef(null);

  // Step state
  const [step, setStep] = useState(1);
  const [dragActive, setDragActive] = useState(false);

  // Parsed file data
  const [fileInfo, setFileInfo] = useState(null);
  // { name, headers, previewRows, allRows, totalRows }

  // Column mapping
  const [mapping, setMapping] = useState({});

  // Step 3 — review
  const [loadingReview, setLoadingReview] = useState(false);
  const [validRows, setValidRows] = useState([]);
  const [invalidRows, setInvalidRows] = useState([]);
  const [duplicates, setDuplicates] = useState([]);
  const [dupeActions, setDupeActions] = useState({});
  const [skipDuplicates, setSkipDuplicates] = useState(true);
  const [sendWelcomeEmail, setSendWelcomeEmail] = useState(false);
  const [showDupeList, setShowDupeList] = useState(false);
  const [showInvalidList, setShowInvalidList] = useState(false);

  // Import execution
  const [importProgress, setImportProgress] = useState(null);
  const [importResults, setImportResults] = useState(null);

  // ── File parsing ─────────────────────────────────────────────────────────

  const parseFile = useCallback(async (file) => {
    if (file.size > 10 * 1024 * 1024) {
      alert('File size exceeds the 10 MB limit. Please split the file and try again.');
      return;
    }
    const ext = file.name.split('.').pop().toLowerCase();
    if (!['csv', 'xlsx', 'xls'].includes(ext)) {
      alert('Unsupported file type. Please upload a .csv, .xlsx, or .xls file.');
      return;
    }

    try {
      let headers = [];
      let allRows = [];

      if (ext === 'csv') {
        await new Promise((resolve, reject) => {
          Papa.parse(file, {
            skipEmptyLines: true,
            complete: ({ data }) => {
              if (!data.length) { reject(new Error('File is empty')); return; }
              headers  = data[0].map(h => String(h).trim());
              allRows  = data.slice(1);
              resolve();
            },
            error: reject,
          });
        });
      } else {
        const buffer = await file.arrayBuffer();
        const wb   = XLSX.read(buffer, { type: 'array' });
        const data = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, defval: '' });
        if (!data.length) { alert('File is empty'); return; }
        headers = data[0].map(h => String(h).trim());
        allRows = data.slice(1).filter(row => row.some(c => c !== ''));
      }

      if (!headers.length) { alert('Could not detect column headers in the first row.'); return; }

      setFileInfo({
        name:        file.name,
        headers,
        previewRows: allRows.slice(0, 5),
        allRows,
        totalRows:   allRows.length,
      });
      setMapping(buildAutoMapping(headers));
      setStep(2);
    } catch (err) {
      alert(`Error reading file: ${err.message}`);
    }
  }, []);

  const handleDrop = useCallback((e) => {
    e.preventDefault(); setDragActive(false);
    const file = e.dataTransfer.files[0];
    if (file) parseFile(file);
  }, [parseFile]);

  const handleFileChange = useCallback((e) => {
    const file = e.target.files[0];
    if (file) parseFile(file);
    e.target.value = '';
  }, [parseFile]);

  // ── Proceed to Step 3 ────────────────────────────────────────────────────

  async function proceedToReview() {
    setLoadingReview(true);
    try {
      // Map + validate every row
      const valid = [], invalid = [];
      fileInfo.allRows.forEach((raw, idx) => {
        const data   = mapRow(raw, fileInfo.headers, mapping);
        const errors = validateMappedRow(data);
        if (errors.length) invalid.push({ idx, data, errors });
        else valid.push({ idx, data });
      });

      // Fetch existing customers for duplicate detection
      const { data: existing = [], error } = await supabase
        .from('customers')
        .select('id, name, address_line_1, postcode');
      if (error) throw error;

      // Detect duplicates
      const dupes = [];
      const actions = {};
      valid.forEach(({ idx, data }) => {
        const byName = existing.find(c =>
          c.name && data.name &&
          c.name.toLowerCase().trim() === data.name.toLowerCase().trim()
        );
        const byAddr = !byName && existing.find(c =>
          c.postcode && data.postcode && c.address_line_1 && data.address_line_1 &&
          c.postcode.toUpperCase().trim()     === data.postcode.toUpperCase().trim() &&
          c.address_line_1.toLowerCase().trim() === data.address_line_1.toLowerCase().trim()
        );
        const match = byName || byAddr;
        if (match) {
          dupes.push({ idx, data, existing: match, matchType: byName ? 'name' : 'address' });
          actions[idx] = 'skip';
        }
      });

      setValidRows(valid);
      setInvalidRows(invalid);
      setDuplicates(dupes);
      setDupeActions(actions);
      setStep(3);
    } catch (err) {
      alert(`Error preparing review: ${err.message}`);
    } finally {
      setLoadingReview(false);
    }
  }

  // ── Import execution ─────────────────────────────────────────────────────

  async function runImport() {
    const dupeIdxSet = new Set(duplicates.map(d => d.idx));
    const BATCH = 50;

    // Build work list
    const toProcess = validRows.map(({ idx, data }) => {
      if (dupeIdxSet.has(idx)) {
        const action = dupeActions[idx] ?? 'skip';
        if (action === 'skip') return { idx, data, action: 'skip' };
        if (action === 'update') {
          const d = duplicates.find(d => d.idx === idx);
          return { idx, data, action: 'update', existingId: d.existing.id };
        }
        return { idx, data, action: 'insert' };
      }
      return { idx, data, action: 'insert' };
    });

    let successful = 0, skipped = 0;
    const errors = [];
    setImportProgress({ current: 0, total: toProcess.length });

    for (let i = 0; i < toProcess.length; i += BATCH) {
      const batch = toProcess.slice(i, i + BATCH);

      // Inserts
      const inserts = batch.filter(r => r.action === 'insert');
      if (inserts.length) {
        const payload = inserts.map(r => ({ ...r.data, imported_from: 'csv_import' }));
        const { error } = await supabase.from('customers').insert(payload);
        if (error) {
          inserts.forEach(r => errors.push({ idx: r.idx, reason: error.message }));
        } else {
          successful += inserts.length;
        }
      }

      // Updates
      for (const item of batch.filter(r => r.action === 'update')) {
        const { error } = await supabase
          .from('customers')
          .update({ ...item.data, imported_from: 'csv_import' })
          .eq('id', item.existingId);
        if (error) errors.push({ idx: item.idx, reason: error.message });
        else successful++;
      }

      // Skipped
      skipped += batch.filter(r => r.action === 'skip').length;

      setImportProgress({ current: Math.min(i + BATCH, toProcess.length), total: toProcess.length });
    }

    // Write import log
    await supabase.from('import_log').insert({
      total_rows:  fileInfo.totalRows,
      successful,
      skipped,
      failed:      errors.length,
    });

    setImportResults({ successful, skipped, failed: errors.length, errors });
    setImportProgress(null);
  }

  // ─── Render ──────────────────────────────────────────────────────────────

  return (
    <div className="max-w-4xl">
      {/* Back + header */}
      <div className="flex items-center gap-3 mb-6">
        <Link to="/customers" className="text-gray-400 hover:text-gray-600 transition-colors">
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
        </Link>
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Import Customers</h1>
          <p className="text-sm text-gray-500 mt-0.5">Upload a CSV or Excel file to add customers in bulk</p>
        </div>
      </div>

      {/* Steps indicator */}
      <StepIndicator current={step} />

      {/* ── Step 1: Upload ──────────────────────────────────── */}
      {step === 1 && (
        <div className="bg-white rounded-xl border border-gray-200 p-6">
          <div className="flex items-center justify-between mb-5">
            <h2 className="font-semibold text-gray-800">Upload File</h2>
            <button
              onClick={downloadTemplate}
              className="text-sm text-blue-600 hover:text-blue-700 flex items-center gap-1.5"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
              </svg>
              Download CSV Template
            </button>
          </div>

          <input
            ref={fileInputRef}
            type="file"
            accept=".csv,.xlsx,.xls"
            className="hidden"
            onChange={handleFileChange}
          />

          <div
            onDragOver={e => { e.preventDefault(); setDragActive(true); }}
            onDragLeave={() => setDragActive(false)}
            onDrop={handleDrop}
            onClick={() => fileInputRef.current?.click()}
            className={`border-2 border-dashed rounded-xl p-16 text-center cursor-pointer transition-all ${
              dragActive
                ? 'border-blue-400 bg-blue-50'
                : 'border-gray-300 hover:border-blue-400 hover:bg-gray-50'
            }`}
          >
            <svg className="w-12 h-12 mx-auto mb-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
            </svg>
            <p className="text-base font-medium text-gray-700 mb-1">
              {dragActive ? 'Drop your file here' : 'Drag & drop your file here'}
            </p>
            <p className="text-sm text-gray-500 mb-4">or click to browse</p>
            <p className="text-xs text-gray-400">Accepts .csv, .xlsx, .xls · Max 10 MB</p>
          </div>
        </div>
      )}

      {/* ── Step 2: Column Mapping ─────────────────────────── */}
      {step === 2 && fileInfo && (
        <div className="space-y-5">
          <div className="bg-white rounded-xl border border-gray-200 p-6">
            <div className="flex items-center justify-between mb-1">
              <h2 className="font-semibold text-gray-800">Map Columns</h2>
              <span className="text-sm text-gray-500 bg-gray-100 px-2.5 py-0.5 rounded-full font-medium">
                Found {fileInfo.totalRows.toLocaleString()} rows
              </span>
            </div>
            <p className="text-sm text-gray-500 mb-5">
              Match the columns in your file to ClearRoute fields. Required fields are marked with <span className="text-red-500">*</span>.
            </p>

            <div className="space-y-2">
              {FIELDS.map(field => (
                <div key={field.key} className="flex items-center gap-4 py-2 border-b border-gray-100 last:border-0">
                  <div className="w-44 flex-shrink-0">
                    <span className="text-sm font-medium text-gray-700">{field.label}</span>
                    {field.required && <span className="text-red-500 ml-0.5">*</span>}
                  </div>
                  <svg className="w-4 h-4 text-gray-300 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                  </svg>
                  <select
                    value={mapping[field.key] ?? '__skip__'}
                    onChange={e => setMapping(m => ({ ...m, [field.key]: e.target.value }))}
                    className={`flex-1 text-sm border rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-500 ${
                      mapping[field.key] && mapping[field.key] !== '__skip__'
                        ? 'border-green-300 bg-green-50 text-green-800'
                        : 'border-gray-300'
                    }`}
                  >
                    <option value="__skip__">— Skip this field —</option>
                    {fileInfo.headers.map(h => (
                      <option key={h} value={h}>{h}</option>
                    ))}
                  </select>
                </div>
              ))}
            </div>
          </div>

          {/* Preview table */}
          <div className="bg-white rounded-xl border border-gray-200 p-6">
            <h3 className="font-semibold text-gray-800 mb-4">Data Preview (first 5 rows)</h3>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-50">
                  <tr>
                    {FIELDS.map(f => (
                      <th key={f.key} className="text-left px-3 py-2 text-xs font-semibold text-gray-500 whitespace-nowrap">
                        {f.label}
                        {f.required && <span className="text-red-400 ml-0.5">*</span>}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {fileInfo.previewRows.map((raw, i) => {
                    const mapped = mapRow(raw, fileInfo.headers, mapping);
                    return (
                      <tr key={i}>
                        {FIELDS.map(f => (
                          <td
                            key={f.key}
                            className={`px-3 py-2 max-w-32 truncate ${
                              f.required && !mapped[f.key]
                                ? 'bg-red-50 text-red-500 italic'
                                : 'text-gray-700'
                            }`}
                          >
                            {mapped[f.key] || (f.required ? 'EMPTY' : '—')}
                          </td>
                        ))}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          <div className="flex items-center justify-between">
            <button
              onClick={() => { setStep(1); setFileInfo(null); setMapping({}); }}
              className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50"
            >
              Back
            </button>
            <button
              onClick={proceedToReview}
              disabled={loadingReview}
              className="px-5 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-60 flex items-center gap-2"
            >
              {loadingReview && (
                <svg className="animate-spin w-4 h-4" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
                </svg>
              )}
              {loadingReview ? 'Checking for duplicates…' : 'Continue to Review'}
            </button>
          </div>
        </div>
      )}

      {/* ── Step 3: Review & Import ────────────────────────── */}
      {step === 3 && (
        <div className="space-y-5">

          {/* Summary cards */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            <SummaryCard label="Total rows" value={fileInfo.totalRows} colour="gray" />
            <SummaryCard label="Ready to import" value={validRows.length - (skipDuplicates ? duplicates.filter(d => (dupeActions[d.idx] ?? 'skip') === 'skip').length : 0)} colour="green" />
            <SummaryCard label="Missing required fields" value={invalidRows.length} colour="red" />
            <SummaryCard label="Potential duplicates" value={duplicates.length} colour="yellow" />
          </div>

          {/* Invalid rows collapsible */}
          {invalidRows.length > 0 && (
            <div className="bg-red-50 border border-red-200 rounded-xl overflow-hidden">
              <button
                className="w-full flex items-center justify-between px-5 py-3 text-sm font-medium text-red-700"
                onClick={() => setShowInvalidList(v => !v)}
              >
                <span>{invalidRows.length} rows will be skipped (missing required fields)</span>
                <ChevronIcon open={showInvalidList} />
              </button>
              {showInvalidList && (
                <div className="border-t border-red-200 divide-y divide-red-100 max-h-56 overflow-y-auto">
                  {invalidRows.map(({ idx, data, errors }) => (
                    <div key={idx} className="px-5 py-2.5 text-xs text-red-700">
                      <span className="font-medium">Row {idx + 2}:</span>{' '}
                      {data.name || '(no name)'} — {errors.join(', ')}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Duplicates collapsible */}
          {duplicates.length > 0 && (
            <div className="bg-yellow-50 border border-yellow-200 rounded-xl overflow-hidden">
              <button
                className="w-full flex items-center justify-between px-5 py-3 text-sm font-medium text-yellow-800"
                onClick={() => setShowDupeList(v => !v)}
              >
                <span>{duplicates.length} potential duplicate{duplicates.length !== 1 ? 's' : ''} detected</span>
                <ChevronIcon open={showDupeList} />
              </button>
              {showDupeList && (
                <div className="border-t border-yellow-200 divide-y divide-yellow-100 max-h-64 overflow-y-auto">
                  {duplicates.map(({ idx, data, existing, matchType }) => (
                    <div key={idx} className="px-5 py-3 flex items-center justify-between gap-4">
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium text-gray-800 truncate">{data.name}</p>
                        <p className="text-xs text-gray-500 truncate">
                          {[data.address_line_1, data.postcode].filter(Boolean).join(', ')}
                          {' '}<span className="text-yellow-600 font-medium">({matchType} match)</span>
                        </p>
                      </div>
                      <select
                        value={dupeActions[idx] ?? 'skip'}
                        onChange={e => setDupeActions(a => ({ ...a, [idx]: e.target.value }))}
                        className="text-xs border border-yellow-300 rounded-lg px-2 py-1 bg-white focus:outline-none focus:ring-1 focus:ring-yellow-400"
                      >
                        <option value="skip">Skip</option>
                        <option value="update">Update existing</option>
                        <option value="import_new">Import as new</option>
                      </select>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Import options */}
          <div className="bg-white rounded-xl border border-gray-200 p-5 space-y-3">
            <h3 className="font-semibold text-gray-800 text-sm">Import Options</h3>
            <Toggle
              id="skip-duplicates"
              checked={skipDuplicates}
              onChange={setSkipDuplicates}
              label="Skip duplicates by default"
              description="Rows that match existing customers will be skipped unless you've set individual actions above."
            />
            <Toggle
              id="welcome-email"
              checked={sendWelcomeEmail}
              onChange={setSendWelcomeEmail}
              label="Send welcome email to imported customers"
              description="Requires email addresses to be mapped and an email integration to be configured."
            />
          </div>

          {/* Progress bar */}
          {importProgress && (
            <div className="bg-white rounded-xl border border-gray-200 p-5">
              <div className="flex items-center justify-between text-sm mb-2">
                <span className="font-medium text-gray-700">Importing…</span>
                <span className="text-gray-500">
                  {importProgress.current} of {importProgress.total}
                </span>
              </div>
              <div className="w-full bg-gray-200 rounded-full h-2.5 overflow-hidden">
                <div
                  className="bg-blue-500 h-2.5 rounded-full transition-all duration-300"
                  style={{ width: `${Math.round((importProgress.current / importProgress.total) * 100)}%` }}
                />
              </div>
            </div>
          )}

          {/* Results */}
          {importResults && (
            <div className="bg-white rounded-xl border border-gray-200 p-5">
              <h3 className="font-semibold text-gray-800 mb-4">Import Complete</h3>
              <div className="grid grid-cols-3 gap-4 mb-4">
                <ResultStat label="Successfully imported" value={importResults.successful} colour="green" />
                <ResultStat label="Skipped (duplicates)" value={importResults.skipped} colour="yellow" />
                <ResultStat label="Failed" value={importResults.failed} colour="red" />
              </div>
              <div className="flex items-center gap-3">
                <Link
                  to="/customers"
                  className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700"
                >
                  View Customers
                </Link>
                {importResults.failed > 0 && (
                  <button
                    onClick={() => downloadErrorReport(importResults.errors, validRows)}
                    className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 flex items-center gap-2"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                    </svg>
                    Download Error Report
                  </button>
                )}
              </div>
            </div>
          )}

          {/* Action buttons */}
          {!importResults && !importProgress && (
            <div className="flex items-center justify-between">
              <button
                onClick={() => setStep(2)}
                className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50"
              >
                Back
              </button>
              <button
                onClick={runImport}
                disabled={validRows.length === 0}
                className="px-5 py-2 text-sm font-medium text-white bg-green-600 rounded-lg hover:bg-green-700 disabled:opacity-50 flex items-center gap-2"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l4-4m0 0l4 4m-4-4v12" />
                </svg>
                Import {validRows.length} Customers
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function StepIndicator({ current }) {
  const steps = ['Upload', 'Map Columns', 'Review & Import'];
  return (
    <div className="flex items-center mb-8">
      {steps.map((label, i) => {
        const n = i + 1;
        const done   = n < current;
        const active = n === current;
        return (
          <div key={n} className="flex items-center flex-1 last:flex-none">
            <div className="flex items-center gap-2">
              <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-semibold flex-shrink-0 ${
                done   ? 'bg-blue-600 text-white' :
                active ? 'bg-blue-600 text-white' :
                         'bg-gray-200 text-gray-500'
              }`}>
                {done ? (
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                  </svg>
                ) : n}
              </div>
              <span className={`text-sm font-medium ${active ? 'text-blue-600' : done ? 'text-gray-700' : 'text-gray-400'}`}>
                {label}
              </span>
            </div>
            {i < steps.length - 1 && (
              <div className={`h-px flex-1 mx-3 ${done ? 'bg-blue-300' : 'bg-gray-200'}`} />
            )}
          </div>
        );
      })}
    </div>
  );
}

function SummaryCard({ label, value, colour }) {
  const colours = {
    gray:   'bg-gray-50  border-gray-200  text-gray-800',
    green:  'bg-green-50 border-green-200 text-green-800',
    red:    'bg-red-50   border-red-200   text-red-800',
    yellow: 'bg-yellow-50 border-yellow-200 text-yellow-800',
  };
  return (
    <div className={`rounded-xl border p-4 ${colours[colour]}`}>
      <p className="text-2xl font-bold">{value.toLocaleString()}</p>
      <p className="text-xs mt-0.5 opacity-75">{label}</p>
    </div>
  );
}

function ResultStat({ label, value, colour }) {
  const colours = { green: 'text-green-600', yellow: 'text-yellow-600', red: 'text-red-600' };
  return (
    <div className="text-center">
      <p className={`text-3xl font-bold ${colours[colour]}`}>{value.toLocaleString()}</p>
      <p className="text-xs text-gray-500 mt-1">{label}</p>
    </div>
  );
}

function Toggle({ id, checked, onChange, label, description }) {
  return (
    <div className="flex items-start gap-3">
      <button
        id={id}
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={`relative inline-flex h-5 w-9 flex-shrink-0 rounded-full transition-colors mt-0.5 ${
          checked ? 'bg-blue-500' : 'bg-gray-300'
        }`}
      >
        <span className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform mt-0.5 ${
          checked ? 'translate-x-4' : 'translate-x-0.5'
        }`} />
      </button>
      <div>
        <label htmlFor={id} className="text-sm font-medium text-gray-700 cursor-pointer">{label}</label>
        <p className="text-xs text-gray-500 mt-0.5">{description}</p>
      </div>
    </div>
  );
}

function ChevronIcon({ open }) {
  return (
    <svg className={`w-4 h-4 transition-transform ${open ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
    </svg>
  );
}
