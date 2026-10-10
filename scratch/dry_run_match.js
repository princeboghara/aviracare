const ExcelJS = require('exceljs');
const fs = require('fs');
const path = require('path');
const { pool } = require('../db');

const parcelDir = 'C:\\Users\\pc\\Desktop\\parcel';

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sept', 'Oct', 'Nov', 'Dec'];

function parseDateFromFilename(filename) {
    const clean = filename.replace(/\s*\(\d+\)/g, '').replace(/\s+\d+/g, '').replace(/\.xlsx.*$/i, '');
    const parts = clean.split('-');
    if (parts.length === 3) {
        const day = parseInt(parts[0], 10);
        const month = parseInt(parts[1], 10);
        let year = parseInt(parts[2], 10);
        if (year < 100) year += 2000;
        const monthName = MONTH_NAMES[month - 1];
        const formattedDate = `${String(day).padStart(2, '0')} ${monthName} ${year}`;
        const consignmentNo = `CN-${day}${month}${year % 100}`;
        const title = `${day}-${month}-${year % 100} Dispatch`;
        return {
            day,
            month,
            year,
            dateStr: `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`,
            dateObj: new Date(year, month - 1, day),
            formattedDate,
            consignmentNo,
            title
        };
    }
    return null;
}

function parseOrderDate(orderDateStr) {
    if (!orderDateStr || !orderDateStr.trim()) return null;
    const d = new Date(orderDateStr.trim());
    return isNaN(d.getTime()) ? null : d;
}

function normalizeName(name) {
    if (!name) return '';
    let n = String(name).toUpperCase().trim();
    n = n.replace(/[^A-Z\s]/g, ' ');
    // Remove honorifics & common suffixes/prefixes
    n = n.replace(/\b(MR|MRS|MS|SMT|SH|SHRI|DR|MISS|BEN|BHAI|DEVI|KUMAR|KUMARI)\b/g, ' ');
    n = n.replace(/\s+/g, ' ').trim();
    return n;
}

function getTokens(str) {
    return normalizeName(str).split(' ').filter(w => w.length > 1);
}

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

function computeSimilarity(peName, exName) {
    const rawPe = String(peName || '').toUpperCase().replace(/[^A-Z\s]/g, ' ').replace(/\s+/g, ' ').trim();
    const rawEx = String(exName || '').toUpperCase().replace(/[^A-Z\s]/g, ' ').replace(/\s+/g, ' ').trim();
    if (rawPe === rawEx && rawPe.length > 0) return 1.0;

    const normPe = normalizeName(peName);
    const normEx = normalizeName(exName);
    if (!normPe || !normEx) return 0;
    if (normPe === normEx) return 0.99;

    const tokensPe = getTokens(peName);
    const tokensEx = getTokens(exName);

    // If both have at least 1 token and identical sets
    if (tokensPe.length > 0 && tokensEx.length > 0) {
        const setPe = new Set(tokensPe);
        const setEx = new Set(tokensEx);
        let inter = 0;
        for (const t of setPe) {
            if (setEx.has(t)) inter++;
        }
        if (inter === setPe.size && inter === setEx.size) return 0.98;

        // Jaccard on tokens
        const tokenScore = (2 * inter) / (setPe.size + setEx.size);
        if (tokenScore >= 0.66) return tokenScore;

        // Check if one token set is fully contained in another (e.g. "RADADIYA UDAY" in "UDAY BHAI RADADIYA")
        if (inter >= 2 && (inter === setPe.size || inter === setEx.size)) {
            return 0.92;
        }
    }

    // Levenshtein on normalized string
    const maxLen = Math.max(normPe.length, normEx.length);
    if (maxLen === 0) return 0;
    const dist = levenshtein(normPe, normEx);
    const levScore = (maxLen - dist) / maxLen;

    return levScore;
}

async function dryRun() {
    console.log('=== DRY RUN MATCHING & CONSIGNMENT ASSIGNMENT ===');

    // 1. Fetch pending entries
    const { rows: pendingEntries } = await pool.query("SELECT * FROM pending_entries WHERE consignment_id IS NULL ORDER BY id ASC");
    console.log(`Unassigned Pending Entries: ${pendingEntries.length}`);

    // 2. Fetch all existing consignments
    const { rows: existingConsignments } = await pool.query("SELECT * FROM consignments");
    console.log(`Existing Consignments: ${existingConsignments.length}`);

    // 3. Read Excel files
    const files = fs.readdirSync(parcelDir).filter(f => f.endsWith('.xlsx') || f.endsWith('.xls'));
    const barcodeMap = new Map();

    for (const file of files) {
        const filePath = path.join(parcelDir, file);
        const dateInfo = parseDateFromFilename(file);
        if (!dateInfo) continue;

        const workbook = new ExcelJS.Workbook();
        await workbook.xlsx.readFile(filePath);
        const sheet = workbook.worksheets[0];
        const headerRow = sheet.getRow(1);
        let barcodeCol = 2, nameCol = 19, mobileCol = 27, pincodeCol = 24, addCol = 20, cityCol = 22, stateCol = 23, weightCol = 3, lCol = 5, bCol = 6, hCol = 7;

        headerRow.eachCell((cell, colNum) => {
            const v = String(cell.value || '').toUpperCase();
            if (v.includes('BARCODE')) barcodeCol = colNum;
            if (v.includes('RECEIVER NAME')) nameCol = colNum;
            if (v.includes('MOBILE') || v.includes('PHONE')) mobileCol = colNum;
            if (v.includes('PIN')) pincodeCol = colNum;
            if (v.includes('ADD LINE 1') || v.includes('ADDRESS')) addCol = colNum;
            if (v.includes('CITY')) cityCol = colNum;
            if (v.includes('STATE')) stateCol = colNum;
            if (v.includes('WEIGHT')) weightCol = colNum;
            if (v.includes('LENGTH')) lCol = colNum;
            if (v.includes('BREADTH')) bCol = colNum;
            if (v.includes('HEIGHT')) hCol = colNum;
        });

        for (let r = 2; r <= sheet.rowCount; r++) {
            const row = sheet.getRow(r);
            const barcode = String(row.getCell(barcodeCol).value || '').trim();
            const name = String(row.getCell(nameCol).value || '').trim();
            if (!barcode || !barcode.startsWith('CG')) continue;

            const rec = {
                file,
                dateInfo,
                barcode,
                name,
                mobile: String(row.getCell(mobileCol).value || '').trim(),
                pincode: String(row.getCell(pincodeCol).value || '').trim(),
                address: String(row.getCell(addCol).value || '').trim(),
                city: String(row.getCell(cityCol).value || '').trim(),
                state: String(row.getCell(stateCol).value || '').trim(),
                weight: parseFloat(row.getCell(weightCol).value) || null,
                length: parseFloat(row.getCell(lCol).value) || null,
                breadth: parseFloat(row.getCell(bCol).value) || null,
                height: parseFloat(row.getCell(hCol).value) || null
            };

            if (!barcodeMap.has(barcode)) {
                barcodeMap.set(barcode, []);
            }
            barcodeMap.get(barcode).push(rec);
        }
    }

    // Dedup excel records: choose earliest file
    const uniqueExcelRecords = [];
    for (const [barcode, list] of barcodeMap.entries()) {
        list.sort((a, b) => a.dateInfo.dateObj - b.dateInfo.dateObj);
        uniqueExcelRecords.push(list[0]);
    }
    console.log(`Unique Excel Parcels: ${uniqueExcelRecords.length}`);

    // Map files to consignments
    const dateConsignmentMap = new Map();
    for (const ex of uniqueExcelRecords) {
        const key = ex.dateInfo.dateStr;
        if (!dateConsignmentMap.has(key)) {
            // Find existing consignment
            let matchedC = existingConsignments.find(c => {
                if (c.consignment_no && c.consignment_no.toUpperCase() === ex.dateInfo.consignmentNo.toUpperCase()) return true;
                if (c.title && c.title.toLowerCase().includes(ex.dateInfo.title.toLowerCase())) return true;
                return false;
            });
            dateConsignmentMap.set(key, {
                dateInfo: ex.dateInfo,
                existing: matchedC || null
            });
        }
    }

    console.log('\nConsignment plan across Excel file dates:');
    for (const [dateStr, info] of dateConsignmentMap.entries()) {
        console.log(`- Date ${dateStr} (${info.dateInfo.title}): ${info.existing ? `Existing ID ${info.existing.id} (${info.existing.consignment_no})` : `Will CREATE (${info.dateInfo.consignmentNo})`}`);
    }

    // Matching Algorithm
    const matched = [];
    const usedBarcodes = new Set();
    const assignedPeIds = new Set();

    // Pass 1: Strict & High confidence (sim >= 0.80) with date constraint
    for (const pe of pendingEntries) {
        const orderDate = parseOrderDate(pe.order_date);
        let best = null, bestScore = 0;

        for (const ex of uniqueExcelRecords) {
            if (usedBarcodes.has(ex.barcode)) continue;
            if (orderDate && ex.dateInfo.dateObj < orderDate) continue;

            const score = computeSimilarity(pe.name, ex.name);
            if (score > bestScore) {
                bestScore = score;
                best = ex;
            }
        }

        if (best && bestScore >= 0.80) {
            assignedPeIds.add(pe.id);
            usedBarcodes.add(best.barcode);
            matched.push({ pe, ex: best, score: bestScore, pass: 1 });
        }
    }

    // Pass 2: Moderate confidence (sim >= 0.65) with date constraint
    for (const pe of pendingEntries) {
        if (assignedPeIds.has(pe.id)) continue;
        const orderDate = parseOrderDate(pe.order_date);
        let best = null, bestScore = 0;

        for (const ex of uniqueExcelRecords) {
            if (usedBarcodes.has(ex.barcode)) continue;
            if (orderDate && ex.dateInfo.dateObj < orderDate) continue;

            const score = computeSimilarity(pe.name, ex.name);
            if (score > bestScore) {
                bestScore = score;
                best = ex;
            }
        }

        if (best && bestScore >= 0.65) {
            assignedPeIds.add(pe.id);
            usedBarcodes.add(best.barcode);
            matched.push({ pe, ex: best, score: bestScore, pass: 2 });
        }
    }

    console.log(`\nResults:`);
    console.log(`Total Matched: ${matched.length} / ${pendingEntries.length} (${((matched.length / pendingEntries.length) * 100).toFixed(1)}%)`);
    console.log(`Pass 1 (High >= 0.80): ${matched.filter(m => m.pass === 1).length}`);
    console.log(`Pass 2 (Fuzzy >= 0.65): ${matched.filter(m => m.pass === 2).length}`);

    const unmatchedPe = pendingEntries.filter(pe => !assignedPeIds.has(pe.id));
    console.log(`Remaining Unmatched Pending: ${unmatchedPe.length}`);

    console.log('\nSample 10 Fuzzy Matches (Pass 2):');
    for (const m of matched.filter(m => m.pass === 2).slice(0, 10)) {
        console.log(`PE: "${m.pe.name}" (Ord: ${m.pe.order_date}) <--> EX: "${m.ex.name}" (Disp: ${m.ex.dateInfo.dateStr}) | Barcode: ${m.ex.barcode} | Score: ${m.score.toFixed(2)}`);
    }

    console.log('\nSample 10 Remaining Unmatched Pending:');
    for (const pe of unmatchedPe.slice(0, 10)) {
        console.log(`PE: "${pe.name}" | OrderDate: ${pe.order_date} | Member: ${pe.member_id}`);
    }

    await pool.end();
}

dryRun().catch(console.error);
