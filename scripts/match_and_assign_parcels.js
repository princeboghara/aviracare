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

    if (tokensPe.length > 0 && tokensEx.length > 0) {
        const setPe = new Set(tokensPe);
        const setEx = new Set(tokensEx);
        let inter = 0;
        for (const t of setPe) {
            if (setEx.has(t)) inter++;
        }
        if (inter === setPe.size && inter === setEx.size) return 0.98;

        const tokenScore = (2 * inter) / (setPe.size + setEx.size);
        if (tokenScore >= 0.66) return tokenScore;

        if (inter >= 2 && (inter === setPe.size || inter === setEx.size)) {
            return 0.92;
        }
    }

    const maxLen = Math.max(normPe.length, normEx.length);
    if (maxLen === 0) return 0;
    const dist = levenshtein(normPe, normEx);
    return (maxLen - dist) / maxLen;
}

async function run() {
    console.log("🚀 Starting Consignment & Pending Parcels Matching & Linking Process...");

    // 1. Fetch pending entries
    const { rows: pendingEntries } = await pool.query("SELECT * FROM pending_entries WHERE consignment_id IS NULL ORDER BY id ASC");
    console.log(`📋 Found ${pendingEntries.length} unassigned pending entries.`);

    // 2. Fetch existing consignments
    const { rows: existingConsignments } = await pool.query("SELECT * FROM consignments");
    console.log(`📦 Found ${existingConsignments.length} existing consignments in database.`);

    // 3. Read and parse all Excel files
    const files = fs.readdirSync(parcelDir).filter(f => f.endsWith('.xlsx') || f.endsWith('.xls'));
    console.log(`📂 Processing ${files.length} Excel dispatch files...`);

    const barcodeMap = new Map();

    for (const file of files) {
        const filePath = path.join(parcelDir, file);
        const dateInfo = parseDateFromFilename(file);
        if (!dateInfo) {
            console.warn(`⚠️ Skipping unparseable filename: ${file}`);
            continue;
        }

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

    // Deduplicate parcels across multiple files by picking earliest date
    const uniqueExcelRecords = [];
    for (const [barcode, list] of barcodeMap.entries()) {
        list.sort((a, b) => a.dateInfo.dateObj - b.dateInfo.dateObj);
        uniqueExcelRecords.push(list[0]);
    }
    console.log(`✨ Total unique dispatch parcels parsed: ${uniqueExcelRecords.length}`);

    // 4. Ensure Consignments exist for all Excel file dates
    const dateConsignmentMap = new Map(); // dateStr -> consignment row { id, consignment_no, ... }

    for (const ex of uniqueExcelRecords) {
        const key = ex.dateInfo.dateStr;
        if (!dateConsignmentMap.has(key)) {
            let matchedC = existingConsignments.find(c => {
                if (c.consignment_no && c.consignment_no.toUpperCase() === ex.dateInfo.consignmentNo.toUpperCase()) return true;
                if (c.title && c.title.toLowerCase().includes(ex.dateInfo.title.toLowerCase())) return true;
                return false;
            });

            if (!matchedC) {
                // Check in DB directly in case another process added it
                const dbCheck = await pool.query('SELECT * FROM consignments WHERE consignment_no = $1', [ex.dateInfo.consignmentNo]);
                if (dbCheck.rows.length > 0) {
                    matchedC = dbCheck.rows[0];
                } else {
                    const ins = await pool.query(`
                        INSERT INTO consignments (consignment_no, title, dispatch_date, status, notes)
                        VALUES ($1, $2, $3, 'ACTIVE', $4)
                        RETURNING *
                    `, [
                        ex.dateInfo.consignmentNo,
                        ex.dateInfo.title,
                        ex.dateInfo.formattedDate,
                        `Auto-created from Excel dispatch ${ex.file}`
                    ]);
                    matchedC = ins.rows[0];
                    console.log(`🆕 Created Consignment: ${matchedC.consignment_no} (${matchedC.title}) with ID ${matchedC.id}`);
                }
            } else {
                console.log(`📌 Reusing Consignment: ${matchedC.consignment_no} (${matchedC.title}) with ID ${matchedC.id}`);
            }

            dateConsignmentMap.set(key, matchedC);
        }
        ex.consignment = dateConsignmentMap.get(key);
    }

    // 5. Match Pending Entries with Excel Records
    console.log("\n🔄 Executing multi-pass intelligent name matching...");
    const matched = [];
    const usedBarcodes = new Set();
    const assignedPeIds = new Set();

    // Pass 1: High confidence (score >= 0.80) with date constraint (order_date <= excel_date)
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

    // Pass 2: Fuzzy matching (score >= 0.65) with date constraint
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

    console.log(`✅ Matched ${matched.length} out of ${pendingEntries.length} pending entries!`);

    // 6. Database Updates in a Transaction
    console.log("💾 Writing updates to PostgreSQL database...");
    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        let updatedPeCount = 0;
        for (const m of matched) {
            const { pe, ex } = m;
            await client.query(`
                UPDATE pending_entries
                SET tracking = $1,
                    mobile = $2,
                    pincode = $3,
                    address = $4,
                    city = $5,
                    state = $6,
                    weight = $7,
                    length = $8,
                    breadth = $9,
                    height = $10,
                    consignment_id = $11
                WHERE id = $12
            `, [
                ex.barcode,
                ex.mobile || null,
                ex.pincode || null,
                ex.address || null,
                ex.city || null,
                ex.state || null,
                ex.weight,
                ex.length,
                ex.breadth,
                ex.height,
                ex.consignment.id,
                pe.id
            ]);
            updatedPeCount++;
        }

        // Also sync all unique Excel parcels into consignment_parcels for archive tracking
        let syncedCpCount = 0;
        for (const ex of uniqueExcelRecords) {
            const cid = ex.consignment.id;
            const exist = await client.query('SELECT id FROM consignment_parcels WHERE consignment_id = $1 AND UPPER(tracking) = $2', [cid, ex.barcode.toUpperCase()]);
            if (exist.rows.length === 0) {
                await client.query(`
                    INSERT INTO consignment_parcels (consignment_id, tracking, weight, length, breadth, height, name, mobile, pincode, city, state, address)
                    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
                `, [
                    cid,
                    ex.barcode,
                    ex.weight ? String(ex.weight) : null,
                    ex.length ? String(ex.length) : null,
                    ex.breadth ? String(ex.breadth) : null,
                    ex.height ? String(ex.height) : null,
                    ex.name,
                    ex.mobile,
                    ex.pincode,
                    ex.city,
                    ex.state,
                    ex.address
                ]);
                syncedCpCount++;
            }
        }

        await client.query('COMMIT');
        console.log(`🎉 TRANSACTION SUCCESS!`);
        console.log(`- Updated ${updatedPeCount} pending entries with tracking, consignment_id, and delivery details.`);
        console.log(`- Synced ${syncedCpCount} parcels into consignment_parcels archive table.`);
    } catch (e) {
        await client.query('ROLLBACK');
        console.error("❌ Transaction failed and rolled back:", e);
        throw e;
    } finally {
        client.release();
    }

    // 7. Summary
    const unmatched = pendingEntries.filter(pe => !assignedPeIds.has(pe.id));
    console.log(`\n================ SUMMARY ================`);
    console.log(`Total Pending Checked: ${pendingEntries.length}`);
    console.log(`Matched & Updated:     ${matched.length}`);
    console.log(`Remaining Unmatched:   ${unmatched.length}`);
    console.log(`=========================================\n`);

    if (unmatched.length > 0) {
        console.log(`Unmatched parcels (${unmatched.length}):`);
        unmatched.forEach((u, i) => {
            console.log(`${i+1}. [${u.member_id}] ${u.name} (Order: ${u.order_date})`);
        });
    }

    await pool.end();
}

run().catch(err => {
    console.error("Fatal error:", err);
    process.exit(1);
});
