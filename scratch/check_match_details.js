const ExcelJS = require('exceljs');
const fs = require('fs');
const path = require('path');
const { pool } = require('../db');

const parcelDir = 'C:\\Users\\pc\\Desktop\\parcel';

function parseDateFromFilename(filename) {
    // Examples: '1-10-26.xlsx', '11-9-26.xlsx', '30-9-26 (1).xlsx', '5-9-26 2.xlsx', '5-9-26.xlsx1.xlsx'
    const clean = filename.replace(/\s*\(\d+\)/g, '').replace(/\s+\d+/g, '').replace(/\.xlsx.*$/i, '');
    const parts = clean.split('-');
    if (parts.length === 3) {
        const day = parseInt(parts[0], 10);
        const month = parseInt(parts[1], 10);
        let year = parseInt(parts[2], 10);
        if (year < 100) year += 2000;
        const dStr = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
        return {
            day,
            month,
            year,
            dateStr: dStr,
            dateObj: new Date(year, month - 1, day)
        };
    }
    return null;
}

// Convert "08 Oct 2026" or "01 Sep 2026" or "2026-10-08" to Date object
function parseOrderDate(orderDateStr) {
    if (!orderDateStr || !orderDateStr.trim()) return null;
    const s = orderDateStr.trim();
    // Check if format like DD Mon YYYY
    const d = new Date(s);
    if (!isNaN(d.getTime())) {
        return d;
    }
    return null;
}

// Normalize name: uppercase, strip honorifics (MR, MRS, MS, SMT, SH, SHRI, DR, KUMAR?), trim multiple spaces
function normalizeName(name) {
    if (!name) return '';
    let n = String(name).toUpperCase().trim();
    // remove special chars except spaces
    n = n.replace(/[^A-Z\s]/g, ' ');
    // remove prefixes
    n = n.replace(/\b(MR|MRS|MS|SMT|SH|SHRI|DR|MISS)\b/g, ' ');
    // collapse whitespace
    n = n.replace(/\s+/g, ' ').trim();
    return n;
}

// Levenshtein distance
function levenshtein(a, b) {
    if (a.length === 0) return b.length;
    if (b.length === 0) return a.length;
    const matrix = [];
    for (let i = 0; i <= b.length; i++) matrix[i] = [i];
    for (let j = 0; j <= a.length; j++) matrix[0][j] = j;
    for (let i = 1; i <= b.length; i++) {
        for (let j = 1; j <= a.length; j++) {
            if (b.charAt(i - 1) === a.charAt(j - 1)) {
                matrix[i][j] = matrix[i - 1][j - 1];
            } else {
                matrix[i][j] = Math.min(
                    matrix[i - 1][j - 1] + 1,
                    matrix[i][j - 1] + 1,
                    matrix[i - 1][j] + 1
                );
            }
        }
    }
    return matrix[b.length][a.length];
}

// Similarity score 0 to 1
function nameSimilarity(name1, name2) {
    const n1 = normalizeName(name1);
    const n2 = normalizeName(name2);
    if (!n1 || !n2) return 0;
    if (n1 === n2) return 1.0;

    // Check if one contains the other
    if (n1.length > 5 && n2.length > 5) {
        if (n1.includes(n2) || n2.includes(n1)) return 0.95;
    }

    // Compare token sets (word order variation e.g. "PATEL SURESH" vs "SURESH PATEL")
    const words1 = n1.split(' ').filter(w => w.length > 1);
    const words2 = n2.split(' ').filter(w => w.length > 1);
    const set1 = new Set(words1);
    const set2 = new Set(words2);
    let intersection = 0;
    for (const w of set1) {
        if (set2.has(w)) intersection++;
    }
    const tokenScore = (2 * intersection) / (set1.size + set2.size);
    if (tokenScore >= 0.8) return tokenScore;

    // Levenshtein ratio
    const maxLen = Math.max(n1.length, n2.length);
    const dist = levenshtein(n1, n2);
    const levScore = (maxLen - dist) / maxLen;

    return Math.max(tokenScore, levScore);
}

async function main() {
    console.log('Loading database columns and pending entries...');
    const peCols = await pool.query("SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'pending_entries'");
    console.log('pending_entries columns:', peCols.rows.map(r => r.column_name).join(', '));

    const { rows: pendingEntries } = await pool.query("SELECT * FROM pending_entries WHERE consignment_id IS NULL ORDER BY id ASC");
    console.log(`Total unassigned pending_entries: ${pendingEntries.length}`);

    // Read all excel files
    const files = fs.readdirSync(parcelDir).filter(f => f.endsWith('.xlsx') || f.endsWith('.xls'));
    console.log(`Found ${files.length} excel files.`);

    const excelRecords = []; // { file, dateInfo, barcode, name, mobile, pincode, address, city, state, weight, length, breadth, height }

    for (const file of files) {
        const filePath = path.join(parcelDir, file);
        const dateInfo = parseDateFromFilename(file);
        if (!dateInfo) {
            console.log(`⚠️ Skipping file ${file}: date could not be parsed.`);
            continue;
        }

        const workbook = new ExcelJS.Workbook();
        await workbook.xlsx.readFile(filePath);
        const sheet = workbook.worksheets[0];
        const headerRow = sheet.getRow(1);

        let colMap = {
            barcode: 2,
            weight: 3,
            length: 5,
            breadth: 6,
            height: 7,
            name: 19,
            address: 20,
            city: 22,
            state: 23,
            pincode: 24,
            mobile: 27
        };

        headerRow.eachCell((cell, colNum) => {
            const v = String(cell.value || '').toUpperCase();
            if (v.includes('BARCODE')) colMap.barcode = colNum;
            if (v.includes('WEIGHT')) colMap.weight = colNum;
            if (v.includes('LENGTH')) colMap.length = colNum;
            if (v.includes('BREADTH')) colMap.breadth = colNum;
            if (v.includes('HEIGHT')) colMap.height = colNum;
            if (v.includes('RECEIVER NAME')) colMap.name = colNum;
            if (v.includes('ADD LINE 1') || v.includes('ADDRESS')) colMap.address = colNum;
            if (v.includes('CITY')) colMap.city = colNum;
            if (v.includes('STATE')) colMap.state = colNum;
            if (v.includes('PINCODE') || v.includes('PIN')) colMap.pincode = colNum;
            if (v.includes('MOBILE') || v.includes('PHONE')) colMap.mobile = colNum;
        });

        for (let r = 2; r <= sheet.rowCount; r++) {
            const row = sheet.getRow(r);
            const barcode = String(row.getCell(colMap.barcode).value || '').trim();
            const name = String(row.getCell(colMap.name).value || '').trim();
            if (!barcode || barcode === 'null' || barcode === 'undefined') continue;

            const mobile = String(row.getCell(colMap.mobile).value || '').trim();
            const pincode = String(row.getCell(colMap.pincode).value || '').trim();
            const address = String(row.getCell(colMap.address).value || '').trim();
            const city = String(row.getCell(colMap.city).value || '').trim();
            const state = String(row.getCell(colMap.state).value || '').trim();
            const weight = parseFloat(row.getCell(colMap.weight).value) || null;
            const length = parseFloat(row.getCell(colMap.length).value) || null;
            const breadth = parseFloat(row.getCell(colMap.breadth).value) || null;
            const height = parseFloat(row.getCell(colMap.height).value) || null;

            excelRecords.push({
                file,
                dateInfo,
                barcode,
                name,
                mobile,
                pincode,
                address,
                city,
                state,
                weight,
                length,
                breadth,
                height
            });
        }
    }

    console.log(`Loaded ${excelRecords.length} total rows from Excels.`);

    // Check duplicate barcodes
    const barcodeMap = new Map();
    for (const rec of excelRecords) {
        if (!barcodeMap.has(rec.barcode)) {
            barcodeMap.set(rec.barcode, []);
        }
        barcodeMap.get(rec.barcode).push(rec);
    }
    console.log(`Unique barcodes in Excels: ${barcodeMap.size}`);

    // Dedup records: keep the earliest date if same barcode appears multiple times
    const uniqueExcelRecords = [];
    for (const [barcode, list] of barcodeMap.entries()) {
        list.sort((a, b) => a.dateInfo.dateObj - b.dateInfo.dateObj);
        uniqueExcelRecords.push(list[0]);
    }

    // Now test matching pending entries with uniqueExcelRecords!
    // Rule from user:
    // 1. Match pending parcel name with excel receiver name (with fuzzy tolerance)
    // 2. Excel date >= order_date (parcels inside an excel were ordered on or before that excel date)
    console.log('\n--- TESTING MATCHING LOGIC ---');

    let matchedCount = 0;
    const matches = [];
    const usedBarcodes = new Set();
    const unmatchedPending = [];

    for (const pe of pendingEntries) {
        const orderDate = parseOrderDate(pe.order_date);
        const peNormName = normalizeName(pe.name);

        let bestMatch = null;
        let bestScore = 0;

        for (const ex of uniqueExcelRecords) {
            if (usedBarcodes.has(ex.barcode)) continue;

            // Date condition: Excel date must be >= orderDate
            if (orderDate && ex.dateInfo.dateObj < orderDate) {
                // Excel is before the order date, cannot be this dispatch
                continue;
            }

            const sim = nameSimilarity(pe.name, ex.name);
            if (sim > bestScore) {
                bestScore = sim;
                bestMatch = ex;
            }
        }

        // Accept match if score >= 0.70 (or high confidence)
        if (bestMatch && bestScore >= 0.70) {
            matchedCount++;
            usedBarcodes.add(bestMatch.barcode);
            matches.push({
                peId: pe.id,
                peName: pe.name,
                peOrderDate: pe.order_date,
                exName: bestMatch.name,
                exBarcode: bestMatch.barcode,
                exFile: bestMatch.file,
                exDate: bestMatch.dateInfo.dateStr,
                score: bestScore.toFixed(2)
            });
        } else {
            unmatchedPending.push({
                peId: pe.id,
                peName: pe.name,
                peOrderDate: pe.order_date,
                bestCandidate: bestMatch ? `${bestMatch.name} (${bestScore.toFixed(2)})` : 'None'
            });
        }
    }

    console.log(`Matched: ${matchedCount} / ${pendingEntries.length} pending parcels (${((matchedCount/pendingEntries.length)*100).toFixed(1)}%)`);
    console.log(`Unmatched: ${unmatchedPending.length}`);

    console.log('\nSample 15 matches:');
    console.table(matches.slice(0, 15));

    if (unmatchedPending.length > 0) {
        console.log('\nSample 10 unmatched pending entries:');
        console.table(unmatchedPending.slice(0, 10));
    }

    await pool.end();
}

main().catch(err => {
    console.error(err);
    process.exit(1);
});
