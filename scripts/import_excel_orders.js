const fs = require('fs');
const path = require('path');
const readline = require('readline');
const ExcelJS = require('exceljs');
const db = require('../db');

function parseCSVLine(line) {
    const result = [];
    let current = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
        const c = line[i];
        if (c === '"') inQuotes = !inQuotes;
        else if (c === ',' && !inQuotes) { result.push(current); current = ''; }
        else current += c;
    }
    result.push(current);
    return result.map(s => s.trim().replace(/^"|"$/g, ''));
}

function normalizeTokens(str) {
    return (str || '')
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, ' ')
        .split(/\s+/)
        .filter(t => t.length > 1);
}

function levenshtein(a, b) {
    if (!a || !b) return (a || '').length + (b || '').length;
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

function isTokenFuzzyMatch(t1, t2) {
    if (t1 === t2) return true;
    if ((t1 === 'sarshvati' && t2.startsWith('saraswat')) || (t2 === 'sarshvati' && t1.startsWith('saraswat'))) return true;
    if ((t1 === 'sobha' && t2 === 'shobha') || (t2 === 'sobha' && t1 === 'shobha')) return true;

    if (t1.length >= 4 && t2.length >= 4) {
        const dist = levenshtein(t1, t2);
        if (dist <= 1) return true;
        if (t1.length >= 7 && dist <= 2) return true;
    }
    if ((t1.startsWith(t2) || t2.startsWith(t1)) && Math.min(t1.length, t2.length) >= 5) {
        return true;
    }
    return false;
}

function scoreNameMatch(excelTokens, csvTokens) {
    if (excelTokens.length === 0 || csvTokens.length === 0) return 0;
    let matches = 0;
    for (const et of excelTokens) {
        const matched = csvTokens.some(ct => isTokenFuzzyMatch(et, ct));
        if (matched) matches++;
    }
    return matches / excelTokens.length;
}

function parseExcelFileDate(filename) {
    const m = filename.match(/^(\d+)-(\d+)-(\d+)/);
    if (!m) return null;
    const day = parseInt(m[1], 10);
    const month = parseInt(m[2], 10) - 1;
    let year = parseInt(m[3], 10);
    if (year < 100) year += 2000;
    return new Date(year, month, day);
}

function parseCSVDate(dateStr) {
    if (!dateStr) return null;
    const clean = dateStr.replace(/(\d+)(st|nd|rd|th)/i, '$1');
    const d = new Date(clean);
    return isNaN(d.getTime()) ? null : d;
}

function formatDateStandard(d) {
    if (!d || isNaN(d.getTime())) return '';
    const day = d.getDate();
    let suffix = 'th';
    if (day === 1 || day === 21 || day === 31) suffix = 'st';
    else if (day === 2 || day === 22) suffix = 'nd';
    else if (day === 3 || day === 23) suffix = 'rd';
    const months = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
    return `${day}${suffix} ${months[d.getMonth()]} ${d.getFullYear()}`;
}

async function runImport() {
    console.log("🚀 Starting import of Excel files & Orders into Confirm Member workspace...");

    const sourceFolder = 'D:\\exceland orders';
    const csvPath = path.join(sourceFolder, 'ALL ORDER TABLE ONLY.csv');

    if (!fs.existsSync(csvPath)) {
        throw new Error(`CSV file not found at: ${csvPath}`);
    }

    // 1. Read CSV orders
    console.log("📄 Loading orders from CSV...");
    const csvStream = fs.createReadStream(csvPath);
    const rl = readline.createInterface({ input: csvStream });

    const csvRows = [];
    let isHeader = true;
    for await (const line of rl) {
        if (isHeader) { isHeader = false; continue; }
        if (!line.trim()) continue;
        const cols = parseCSVLine(line);
        const dateObj = parseCSVDate(cols[1]);
        csvRows.push({
            srNo: cols[0] || '',
            dateRaw: cols[1] || '',
            dateObj: dateObj,
            dateStandard: formatDateStandard(dateObj),
            orderNumber: cols[2] || '',
            billBy: cols[3] || '',
            memberId: (cols[4] || '').toUpperCase().trim(),
            name: (cols[5] || '').trim(),
            tokens: normalizeTokens(cols[5]),
            email: cols[6] || '',
            pv: (cols[7] || '').trim(),
            amount: (cols[8] || '').trim(),
            status: (cols[9] || '').trim().toLowerCase()
        });
    }
    console.log(`✅ Loaded ${csvRows.length} orders from CSV.`);

    // 2. Read all date-named Excel files
    const xlsxFiles = fs.readdirSync(sourceFolder).filter(f => f.endsWith('.xlsx'));
    console.log(`📊 Found ${xlsxFiles.length} date-named Excel files:`, xlsxFiles);

    const finalEntries = [];
    const seenTrackings = new Set();

    for (const f of xlsxFiles) {
        const fileDate = parseExcelFileDate(f);
        const filePath = path.join(sourceFolder, f);
        const wb = new ExcelJS.Workbook();
        await wb.xlsx.readFile(filePath);
        const ws = wb.worksheets[0];

        ws.eachRow((row, num) => {
            if (num === 1) return;
            const tracking = (row.getCell(2).text || (row.getCell(2).value || '').toString()).trim().toUpperCase();
            const rawName = (row.getCell(19).text || (row.getCell(19).value || '').toString()).trim();
            if (!tracking && !rawName) return;

            // Deduplicate tracking
            if (seenTrackings.has(tracking)) {
                console.log(`⚠️ Skipping duplicate tracking: ${tracking} in ${f}`);
                return;
            }
            seenTrackings.add(tracking);

            const getVal = (cell) => {
                if (!cell) return '';
                if (typeof cell.value === 'object' && cell.value !== null) {
                    return cell.value.result ? String(cell.value.result).trim() : (cell.text ? String(cell.text).trim() : '');
                }
                return cell.text ? String(cell.text).trim() : (cell.value !== null && cell.value !== undefined ? String(cell.value).trim() : '');
            };

            const weight = getVal(row.getCell(3));
            const length = getVal(row.getCell(5));
            const breadth = getVal(row.getCell(6));
            const height = getVal(row.getCell(7));
            const address = getVal(row.getCell(20));
            const city = getVal(row.getCell(22));
            const state = getVal(row.getCell(23));
            const pincode = getVal(row.getCell(24));
            const mobile = getVal(row.getCell(26));

            const excelTokens = normalizeTokens(rawName);

            let bestCandidate = null;
            let bestScore = -1;
            let minDateDiffDays = 9999;

            for (const csvItem of csvRows) {
                const s = scoreNameMatch(excelTokens, csvItem.tokens);
                if (s >= 0.5) {
                    if (excelTokens.length === 1 && s < 1 && excelTokens[0] !== 'sobha' && excelTokens[0] !== 'sarshvati') continue;

                    let daysDiff = 9999;
                    if (fileDate && csvItem.dateObj) {
                        daysDiff = Math.abs((fileDate.getTime() - csvItem.dateObj.getTime()) / (1000 * 60 * 60 * 24));
                    }

                    if (s > bestScore || (s === bestScore && daysDiff < minDateDiffDays)) {
                        bestScore = s;
                        minDateDiffDays = daysDiff;
                        bestCandidate = csvItem;
                    }
                }
            }

            if (bestCandidate && bestScore >= 0.5) {
                finalEntries.push({
                    tracking,
                    name: (bestCandidate.name || rawName).toUpperCase().trim(),
                    member_id: bestCandidate.memberId,
                    order_date: bestCandidate.dateStandard || bestCandidate.dateRaw,
                    pv: bestCandidate.pv || '0',
                    amount: bestCandidate.amount || '0',
                    weight,
                    length,
                    breadth,
                    height,
                    mobile,
                    pincode,
                    city,
                    state,
                    address,
                    sourceFile: f
                });
            } else {
                finalEntries.push({
                    tracking,
                    name: rawName.toUpperCase().trim(),
                    member_id: '',
                    order_date: '',
                    pv: '0',
                    amount: '0',
                    weight,
                    length,
                    breadth,
                    height,
                    mobile,
                    pincode,
                    city,
                    state,
                    address,
                    sourceFile: f
                });
            }
        });
    }

    console.log(`\n📦 Prepared ${finalEntries.length} parcel entries for insertion into pending_entries.`);
    const matchedCount = finalEntries.filter(e => e.member_id).length;
    console.log(`✨ Matched with member info: ${matchedCount} / ${finalEntries.length}`);

    // 3. Database Insertion Transaction
    const client = await db.pool.connect();
    try {
        await client.query('BEGIN');

        console.log("💾 Inserting entries into pending_entries table...");
        const insertQuery = `
            INSERT INTO pending_entries 
            (tracking, weight, length, breadth, height, name, mobile, pincode, city, state, address, member_id, order_date, pv, amount)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
        `;

        for (const item of finalEntries) {
            await client.query(insertQuery, [
                item.tracking,
                item.weight || '',
                item.length || '',
                item.breadth || '',
                item.height || '',
                item.name || '',
                item.mobile || '',
                item.pincode || '',
                item.city || '',
                item.state || '',
                item.address || '',
                item.member_id || '',
                item.order_date || '',
                item.pv || '0',
                item.amount || '0'
            ]);
        }

        // 4. Also safely sync orders_master with orders from CSV if not existing
        console.log("🔄 Syncing orders_master with CSV records...");
        const existingMaster = await client.query('SELECT order_date, member_id, name, pv, amount FROM orders_master');
        const existingMasterSet = new Set(
            existingMaster.rows.map(r => 
                `${String(r.order_date || '').trim()}|${String(r.member_id || '').trim().toUpperCase()}|${String(r.name || '').trim().toUpperCase()}|${String(r.pv || '0').trim()}|${String(r.amount || '0').trim()}`
            )
        );

        let masterInserted = 0;
        const masterInsertSql = `
            INSERT INTO orders_master (order_date, member_id, name, pv, amount)
            VALUES ($1, $2, $3, $4, $5)
        `;

        for (const row of csvRows) {
            const dateStr = row.dateStandard || row.dateRaw;
            const sig = `${dateStr}|${row.memberId}|${row.name.toUpperCase().trim()}|${row.pv}|${row.amount}`;
            if (!existingMasterSet.has(sig)) {
                existingMasterSet.add(sig);
                await client.query(masterInsertSql, [
                    dateStr,
                    row.memberId,
                    row.name.toUpperCase().trim(),
                    row.pv || '0',
                    row.amount || '0'
                ]);
                masterInserted++;
            }
        }
        console.log(`✅ Added ${masterInserted} new orders to orders_master table.`);

        await client.query('COMMIT');
        console.log("🎉 Successfully committed all transactions to PostgreSQL!");

    } catch (dbErr) {
        await client.query('ROLLBACK');
        console.error("❌ Database transaction failed. Rolled back.", dbErr);
        throw dbErr;
    } finally {
        client.release();
    }

    // Verify counts
    const pendingCount = await db.query('SELECT COUNT(*) FROM pending_entries');
    console.log(`\n📋 Current pending_entries in DB: ${pendingCount.rows[0].count}`);
    process.exit(0);
}

runImport().catch(err => {
    console.error("Fatal Error during import:", err);
    process.exit(1);
});
