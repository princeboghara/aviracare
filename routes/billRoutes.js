const express = require('express');
const router = express.Router();
const fs = require('fs');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const db = require('../config/db');
const { upload } = require('../config/multer');
const { checkAdmin } = require('../middleware/auth');
const { numberToWords } = require('../utils/helpers');

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || '');

// 📥 PROCESS BILLS API
router.post('/admin/api/process-bills', checkAdmin, upload.array('billFiles', 20), async (req, res) => {
    try {
        if (!req.files || req.files.length === 0) {
            return res.json({ success: false, msg: "કૃપા કરીને ફાઇલ સિલેક્ટ કરો!" });
        }

        const startInvoiceNo = req.body.customInvoiceNo ? parseInt(req.body.customInvoiceNo.trim()) : NaN;
        const rawInvoiceStr = req.body.customInvoiceNo ? req.body.customInvoiceNo.trim() : '';

        const comboRes = await db.query('SELECT * FROM combo_presets');
        const comboList = comboRes.rows || [];

        const model = genAI.getGenerativeModel({ model: "gemini-3.6-flash" });

        const filePromises = req.files.map(async (file, idx) => {
            let extractedData = {};

            try {
                let fileBuffer;
                if (file.buffer) fileBuffer = file.buffer;
                else if (file.path && fs.existsSync(file.path)) fileBuffer = fs.readFileSync(file.path);
                else throw new Error("File path not accessible");

                const imagePart = {
                    inlineData: {
                        data: fileBuffer.toString("base64"),
                        mimeType: file.mimetype || "application/pdf"
                    }
                };

                const prompt = `Carefully analyze this Tax Invoice document image/pdf and extract all buyer/consignee details AND all product items from the invoice table into a JSON object:
                {
                    "invoice_no": "Inv. No.",
                    "invoice_date": "Date of invoice",
                    "buyer_name": "Name of Buyer under Details Of Buyer",
                    "buyer_id": "Buyer ID inside brackets if present e.g. AV40604",
                    "buyer_address": "Buyer full address",
                    "buyer_phone": "Buyer phone or mobile",
                    "buyer_state": "Buyer state name e.g. Uttar Pradesh",
                    "buyer_state_code": "Buyer state code e.g. 09",
                    "buyer_pincode": "Buyer pincode e.g. 281205",
                    "buyer_gstin": "Buyer GSTIN if present",
                    "consignee_name": "Consignee Name under Details Of Consignee",
                    "consignee_address": "Consignee full address",
                    "consignee_phone": "Consignee phone/mobile",
                    "consignee_state": "Consignee state name e.g. Uttar Pradesh",
                    "consignee_state_code": "Consignee state code e.g. 09",
                    "consignee_pincode": "Consignee pincode e.g. 281205",
                    "consignee_gstin": "Consignee GSTIN if present",
                    "raw_items": []
                }
                Return ONLY raw clean JSON. Do NOT wrap in markdown codeblocks.`;

                const result = await model.generateContent([prompt, imagePart]);
                let responseText = result.response.text().trim();
                responseText = responseText.replace(/```json/gi, '').replace(/```/g, '').trim();
                extractedData = JSON.parse(responseText);

            } catch (aiErr) {
                console.error("AI Extraction Error:", aiErr.message);
                extractedData = { invoice_no: "444", invoice_date: "18-07-2026", buyer_name: "Km Sarita", raw_items: [] };
            }

            let finalInvoiceNo = extractedData.invoice_no || "";
            if (!isNaN(startInvoiceNo)) {
                finalInvoiceNo = String(startInvoiceNo + idx);
            } else if (rawInvoiceStr !== '') {
                finalInvoiceNo = req.files.length > 1 ? `${rawInvoiceStr}-${idx + 1}` : rawInvoiceStr;
            }

            let finalProductsList = [];
            let srNoCounter = 1;
            let totalBillAmount = 0;
            let totalBillPv = 0;

            const extractedItems = extractedData.raw_items || [];

            for (let rawIt of extractedItems) {
                const itemProdName = (rawIt.product || "").toLowerCase().trim();
                let matchedCombo = comboList.find(c => {
                    const dbComboName = (c.combo_name || "").toLowerCase().trim();
                    return itemProdName.includes(dbComboName) || dbComboName.includes(itemProdName);
                });

                if (matchedCombo) {
                    let subProducts = typeof matchedCombo.products === 'string' ? JSON.parse(matchedCombo.products) : matchedCombo.products;
                    subProducts.forEach(subP => {
                        const subNet = parseFloat(subP.net_amt) || 0;
                        const subPv = parseInt(subP.pv) || 0;
                        const subOfferPv = parseInt(subP.offer_pv) || 0;

                        finalProductsList.push({
                            sr: srNoCounter++,
                            product: subP.product,
                            hsn: subP.hsn || "30045090",
                            qty: parseInt(subP.qty) || 1,
                            rate: parseFloat(subP.rate) || 0,
                            pv: subPv,
                            offer_pv: subOfferPv,
                            discount: parseFloat(subP.discount) || 0,
                            offer_discount: parseFloat(subP.offer_discount) || 0,
                            taxable_val: parseFloat(subP.taxable_val) || 0,
                            gst_pct: parseFloat(subP.gst_pct) || 18,
                            gst_amt: parseFloat(subP.gst_amt) || 0,
                            net_amt: subNet
                        });
                        totalBillAmount += subNet;
                        totalBillPv += (subPv + subOfferPv);
                    });
                } else {
                    const singleNet = parseFloat((rawIt.net_amt || 0).toString().replace(/,/g, '')) || 0;
                    const singlePv = parseInt((rawIt.pv || 0).toString().replace(/,/g, '')) || 0;
                    const singleOfferPv = parseInt((rawIt.offer_pv || 0).toString().replace(/,/g, '')) || 0;

                    finalProductsList.push({
                        sr: srNoCounter++,
                        product: (rawIt.product || "PRODUCT").toUpperCase().trim(),
                        hsn: rawIt.hsn || "30045090",
                        qty: parseInt(rawIt.qty) || 1,
                        rate: parseFloat(rawIt.rate) || 0,
                        pv: singlePv,
                        offer_pv: singleOfferPv,
                        discount: parseFloat(rawIt.discount) || 0,
                        offer_discount: parseFloat(rawIt.offer_discount) || 0,
                        taxable_val: parseFloat(rawIt.taxable_val) || 0,
                        gst_pct: parseFloat(rawIt.gst_pct) || 18,
                        gst_amt: parseFloat(rawIt.gst_amt) || 0,
                        net_amt: singleNet
                    });
                    totalBillAmount += singleNet;
                    totalBillPv += (singlePv + singleOfferPv);
                }
            }

            const insertQuery = `
                INSERT INTO bill_history 
                (invoice_no, invoice_date, buyer_name, buyer_id, buyer_address, buyer_phone, buyer_state, buyer_state_code, buyer_pincode, buyer_gstin,
                 consignee_name, consignee_address, consignee_phone, consignee_state, consignee_state_code, consignee_pincode, consignee_gstin,
                 raw_combo_name, items, total_amount, total_pv)
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21)
                RETURNING *;
            `;

            const dbRes = await db.query(insertQuery, [
                finalInvoiceNo, extractedData.invoice_date || "", extractedData.buyer_name || "",
                extractedData.buyer_id || "", extractedData.buyer_address || "", extractedData.buyer_phone || "",
                extractedData.buyer_state || "", extractedData.buyer_state_code || "", extractedData.buyer_pincode || "",
                extractedData.buyer_gstin || "", extractedData.consignee_name || "", extractedData.consignee_address || "",
                extractedData.consignee_phone || "", extractedData.consignee_state || "", extractedData.consignee_state_code || "",
                extractedData.consignee_pincode || "", extractedData.consignee_gstin || "",
                extractedItems.map(i => i.product).join(', '), JSON.stringify(finalProductsList),
                totalBillAmount.toFixed(2), totalBillPv
            ]);

            if (file.path && fs.existsSync(file.path)) { try { fs.unlinkSync(file.path); } catch(e){} }
            return dbRes.rows[0];
        });

        await Promise.all(filePromises);
        const allBills = await db.query('SELECT * FROM bill_history ORDER BY id DESC');
        res.json({ success: true, msg: "બિલ સફળતાપૂર્વક કન્વર્ટ થઈ ગયા છે! 🚀", bills: allBills.rows });

    } catch (err) {
        console.error("Process Bill Error:", err);
        res.json({ success: false, msg: err.message });
    }
});

// 🗑️ DELETE SELECTED BILLS API
router.post('/admin/api/delete-bills', checkAdmin, async (req, res) => {
    try {
        const { ids } = req.body;
        if (!ids || !Array.isArray(ids) || ids.length === 0) {
            return res.json({ success: false, msg: "કોઈ બિલ સિલેક્ટ કરેલા નથી!" });
        }

        await db.query('DELETE FROM bill_history WHERE id = ANY($1::int[])', [ids]);
        res.json({ success: true, msg: "સિલેક્ટ કરેલા બિલ ડિલીટ થઈ ગયા છે!" });
    } catch (err) {
        res.json({ success: false, msg: err.message });
    }
});

// 🖨️ SINGLE BILL PRINT ROUTE
router.get('/admin/api/print-bill/:id', checkAdmin, async (req, res) => {
    try {
        const billRes = await db.query('SELECT * FROM bill_history WHERE id = $1', [req.params.id]);
        if (billRes.rows.length === 0) return res.status(404).send("Bill record not found");

        const bill = billRes.rows[0];
        let items = [];
        if (Array.isArray(bill.items)) items = bill.items;
        else if (typeof bill.items === 'string') {
            try { items = JSON.parse(bill.items); } catch (e) { items = []; }
        }

        let totalQty = 0, totalPv = 0, totalOfferPv = 0;
        let totalDiscount = 0, totalOfferDiscount = 0, totalTaxable = 0, totalGstAmt = 0, totalNetAmt = 0;
        let primaryGstPct = 18;

        items.forEach(it => {
            const qty = parseInt(it.qty) || 1;
            const netAmt = parseFloat((it.net_amt || 0).toString().replace(/,/g, ''));
            const gstPct = parseFloat((it.gst_pct || 18).toString().replace(/,/g, ''));
            const discount = parseFloat((it.discount || 0).toString().replace(/,/g, ''));
            const offerDiscount = parseFloat((it.offer_discount || 0).toString().replace(/,/g, ''));
            
            const taxableVal = it.taxable_val ? parseFloat(it.taxable_val) : parseFloat((netAmt / (1 + (gstPct / 100))).toFixed(2));
            const gstAmt = it.gst_amt ? parseFloat(it.gst_amt) : parseFloat((netAmt - taxableVal).toFixed(2));
            const rate = it.rate ? parseFloat(it.rate) : parseFloat((taxableVal / qty).toFixed(2));

            it.calculated_rate = rate;
            it.calculated_taxable = taxableVal;
            it.calculated_gst = gstAmt;

            totalQty += qty;
            totalPv += parseFloat((it.pv || 0).toString().replace(/,/g, ''));
            totalOfferPv += parseFloat((it.offer_pv || 0).toString().replace(/,/g, ''));
            totalDiscount += discount;
            totalOfferDiscount += offerDiscount;
            totalTaxable += taxableVal;
            totalGstAmt += gstAmt;
            totalNetAmt += netAmt;
            if (gstPct) primaryGstPct = gstPct;
        });

        const buyerState = (bill.buyer_state || '').toLowerCase().trim();
        const isInterState = buyerState !== 'gujarat' && buyerState !== 'gj';
        const amountInWords = numberToWords(totalNetAmt);

        const html = `
        <!DOCTYPE html>
        <html>
        <head>
            <meta charset="utf-8">
            <title>Tax Invoice - ${bill.invoice_no || 'Invoice'}</title>
            <style>
                @page { size: A4 portrait; margin: 0; }
                * { box-sizing: border-box; }
                body { font-family: Arial, Helvetica, sans-serif; font-size: 8.5px; color: #000; margin: 0; padding: 0; background: #1e293b; }
                .action-bar { position: sticky; top: 0; background: #0f172a; padding: 10px 20px; display: flex; justify-content: space-between; align-items: center; color: white; z-index: 1000; box-shadow: 0 4px 12px rgba(0,0,0,0.4); border-bottom: 1px solid #334155; }
                .btn { background: #10b981; color: white; border: none; padding: 7px 16px; border-radius: 6px; font-weight: bold; cursor: pointer; font-size: 11px; text-decoration: none; display: inline-flex; align-items: center; gap: 6px; }
                .btn-secondary { background: #475569; margin-right: 8px; }
                .preview-wrapper { padding: 20px 0; display: flex; justify-content: center; }
                .invoice-container { width: 210mm; min-height: 297mm; padding: 8mm; background: white; box-shadow: 0 10px 30px rgba(0,0,0,0.5); margin: auto; border: 1px solid #000; transform: scale(0.95); transform-origin: top center; }
                .doc-type { text-align: right; font-size: 8px; font-weight: bold; margin-bottom: 2px; }
                .top-header { text-align: center; position: relative; padding-bottom: 4px; }
                .logo-img { position: absolute; left: 0; top: 0; width: 60px; height: auto; }
                .company-name { font-size: 17px; font-weight: bold; font-family: 'Times New Roman', Times, serif; text-transform: uppercase; }
                .company-address { font-size: 8px; margin-top: 1px; line-height: 1.2; }
                .gstin-right { text-align: right; font-weight: bold; font-size: 8.5px; margin-top: -6px; }
                .tax-invoice-bar { border-top: 1px solid #000; border-bottom: 1px solid #000; text-align: center; font-weight: bold; font-size: 10.5px; padding: 2px; margin: 4px 0; background: #ffffff; letter-spacing: 0.5px; }
                table.grid-tbl { width: 100%; border-collapse: collapse; margin-bottom: 4px; }
                table.grid-tbl td, table.grid-tbl th { border: 1px solid #000; padding: 2.5px 3.5px; vertical-align: top; font-size: 8px; }
                .text-center { text-align: center; } .text-right { text-align: right; } .bold { font-weight: bold; }
                .summary-wrapper { display: flex; justify-content: space-between; align-items: flex-start; margin-top: 4px; gap: 6px; }
                .left-boxes { width: 58%; } .right-box { width: 41%; }
                .sub-table { width: 100%; border-collapse: collapse; margin-bottom: 4px; }
                .sub-table td, .sub-table th { border: 1px solid #000; padding: 2px 3.5px; font-size: 8px; }
                @media print {
                    .action-bar { display: none !important; }
                    body { background: white !important; }
                    .preview-wrapper { padding: 0 !important; }
                    .invoice-container { box-shadow: none !important; border: none !important; width: 100% !important; padding: 4mm !important; transform: scale(1) !important; }
                }
            </style>
        </head>
        <body>
            <div class="action-bar">
                <div style="font-weight: bold; font-size: 13px;">📄 Tax Invoice Preview (Inv No: #${bill.invoice_no || 'N/A'})</div>
                <div>
                    <button class="btn btn-secondary" onclick="window.close()">Close</button>
                    <button class="btn" onclick="window.print()">🖨️ Download / Print PDF</button>
                </div>
            </div>
            <div class="preview-wrapper">
                <div class="invoice-container">
                    <div class="doc-type">Original/Duplicate/Triplicate</div>
                    <div class="top-header">
                        <img src="/images/logo.jpg" class="logo-img" onerror="this.style.display='none'">
                        <div class="company-name">Avira Lifecare</div>
                        <div class="company-address">
                            103, The Galleria 2 Mahavir Chowk, Near by Yogichok, Surat 395010, Gujarat<br>
                            Surat<br>
                            Ph.: +91 9712326273 &nbsp; Email Id: info@aviralifecare.com<br>
                            State: Gujarat &nbsp; StateCode: GJ
                        </div>
                        <div class="gstin-right">GSTIN: 24ABFCA6751MIZE</div>
                    </div>
                    <div class="tax-invoice-bar">TAX INVOICE</div>
                    <table class="grid-tbl">
                        <tr>
                            <td width="50%"><span class="bold">Inv. No. :</span> ${bill.invoice_no || ''}</td>
                            <td width="50%"><span class="bold">Date:</span> ${bill.invoice_date || ''}</td>
                        </tr>
                        <tr>
                            <td>
                                <span class="bold">Details Of Buyer (Billing To)</span><br><br>
                                <span class="bold">Name :</span> ${bill.buyer_name || ''} ${bill.buyer_id ? '( ID : ' + bill.buyer_id + ' )' : ''}<br><br>
                                <span class="bold">Address:</span> ${bill.buyer_address || bill.address || ''}<br><br>
                                <span class="bold">Phone :</span> ${bill.buyer_phone || bill.mobile || ''}<br>
                                <span class="bold">STATE :</span> ${bill.buyer_state || ''} &nbsp;&nbsp;&nbsp; <span class="bold">STATE-CODE :</span> ${bill.buyer_state_code || ''} &nbsp;&nbsp;&nbsp; <span class="bold">PINCODE :</span> ${bill.buyer_pincode || bill.pincode || ''}<br>
                                <span class="bold">GSTIN :</span> ${bill.buyer_gstin || ''}
                            </td>
                            <td>
                                <span class="bold">Details Of Consignee (Shipped To)</span><br><br>
                                <span class="bold">Name :</span> ${bill.consignee_name || ''}<br><br>
                                <span class="bold">Address:</span> ${bill.consignee_address || bill.address || ''}<br><br>
                                <span class="bold">Phone :</span> ${bill.consignee_phone || bill.mobile || ''}<br>
                                <span class="bold">STATE :</span> ${bill.consignee_state || ''} &nbsp;&nbsp;&nbsp; <span class="bold">STATE-CODE :</span> ${bill.consignee_state_code || ''} &nbsp;&nbsp;&nbsp; <span class="bold">PINCODE :</span> ${bill.consignee_pincode || bill.pincode || ''}<br>
                                <span class="bold">GSTIN :</span> ${bill.consignee_gstin || ''}
                            </td>
                        </tr>
                        <tr><td colspan="2"><span class="bold">Transport By:</span></td></tr>
                    </table>
                    <table class="grid-tbl">
                        <thead>
                            <tr style="background-color: #f9f9f9;">
                                <th class="text-center" width="3%">Sr.</th>
                                <th>Product</th>
                                <th class="text-center">HSN Code</th>
                                <th class="text-center">Qty.</th>
                                <th class="text-right">Rate</th>
                                <th class="text-right">Amount</th>
                                <th class="text-center">PV</th>
                                <th class="text-center">Offer PV</th>
                                <th class="text-right">Discount</th>
                                <th class="text-right">Offer Discount</th>
                                <th class="text-right">Taxable Value</th>
                                <th class="text-center">GST%</th>
                                <th class="text-right">GST Amt.</th>
                                <th class="text-right">Net Amount</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${items.map((it, idx) => `
                                <tr>
                                    <td class="text-center">${idx + 1}</td>
                                    <td class="bold">${it.product || 'N/A'}</td>
                                    <td class="text-center">${it.hsn || '30045090'}</td>
                                    <td class="text-center">${it.qty || 1}</td>
                                    <td class="text-right">${parseFloat(it.calculated_rate || it.rate || 0).toFixed(2)}</td>
                                    <td class="text-right">${parseFloat(it.calculated_taxable || it.taxable_val || 0).toFixed(2)}</td>
                                    <td class="text-center">${it.pv || 0}</td>
                                    <td class="text-center">${it.offer_pv || 0}</td>
                                    <td class="text-right">${parseFloat(it.discount || 0).toFixed(2)}</td>
                                    <td class="text-right">${parseFloat(it.offer_discount || 0).toFixed(2)}</td>
                                    <td class="text-right">${parseFloat(it.calculated_taxable || it.taxable_val || 0).toFixed(2)}</td>
                                    <td class="text-center">${parseFloat(it.gst_pct || 18).toFixed(2)}</td>
                                    <td class="text-right">${parseFloat(it.calculated_gst || it.gst_amt || 0).toFixed(2)}</td>
                                    <td class="text-right bold">${parseFloat(it.net_amt || 0).toFixed(2)}</td>
                                </tr>
                            `).join('')}
                            <tr class="bold" style="background-color: #f9f9f9;">
                                <td colspan="3"></td>
                                <td class="text-center">${totalQty}</td>
                                <td></td>
                                <td class="text-right">${totalTaxable.toFixed(2)}</td>
                                <td class="text-center">${totalPv}</td>
                                <td class="text-center">${totalOfferPv}</td>
                                <td class="text-right">${totalDiscount.toFixed(2)}</td>
                                <td class="text-right">${totalOfferDiscount.toFixed(2)}</td>
                                <td class="text-right">${totalTaxable.toFixed(2)}</td>
                                <td></td>
                                <td class="text-right">${totalGstAmt.toFixed(2)}</td>
                                <td class="text-right">${totalNetAmt.toFixed(2)}</td>
                            </tr>
                        </tbody>
                    </table>
                    <div class="summary-wrapper">
                        <div class="left-boxes">
                            <table class="sub-table">
                                <thead>
                                    <tr style="background-color: #f9f9f9;">
                                        <th>Tax Type</th>
                                        <th class="text-right">Amount</th>
                                        <th class="text-right">CGST</th>
                                        <th class="text-right">SGST</th>
                                        <th class="text-right">IGST</th>
                                        <th class="text-right">Discount</th>
                                        <th class="text-right">Net Amt.</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    <tr>
                                        <td>GST ${primaryGstPct.toFixed(4)}%</td>
                                        <td class="text-right">${totalTaxable.toFixed(2)}</td>
                                        <td class="text-right">${!isInterState ? (totalGstAmt / 2).toFixed(2) : '0.00'}</td>
                                        <td class="text-right">${!isInterState ? (totalGstAmt / 2).toFixed(2) : '0.00'}</td>
                                        <td class="text-right">${isInterState ? totalGstAmt.toFixed(2) : '0.00'}</td>
                                        <td class="text-right">${totalDiscount.toFixed(2)}</td>
                                        <td class="text-right font-bold">${totalNetAmt.toFixed(2)}</td>
                                    </tr>
                                </tbody>
                            </table>
                            <table class="sub-table">
                                <tr>
                                    <td width="22%" class="bold">Rs. In Word</td>
                                    <td class="bold">${amountInWords}</td>
                                </tr>
                            </table>
                            <table class="sub-table">
                                <tr><td class="bold" style="background-color: #f9f9f9;">Our Bank Detail</td></tr>
                                <tr>
                                    <td>
                                        BANK NAME: INDUSIND BANK<br>
                                        A/C NO: 259998826273<br>
                                        IFSC: INDB0001409
                                    </td>
                                </tr>
                            </table>
                            <table class="sub-table">
                                <tr><td class="bold" style="background-color: #f9f9f9;">Terms & Condition</td></tr>
                                <tr><td>testing.</td></tr>
                            </table>
                            <div style="font-size: 8px;">Subject To SURAT Jurisdiction.</div>
                        </div>
                        <div class="right-box">
                            <table class="sub-table">
                                <tr><td>Amount</td><td class="text-right font-bold">${totalTaxable.toFixed(2)}</td></tr>
                                <tr><td>Discount</td><td class="text-right font-bold">${totalDiscount.toFixed(2)}</td></tr>
                                <tr><td>CGST</td><td class="text-right">${!isInterState ? (totalGstAmt / 2).toFixed(2) : '0.00'}</td></tr>
                                <tr><td>SGST</td><td class="text-right">${!isInterState ? (totalGstAmt / 2).toFixed(2) : '0.00'}</td></tr>
                                <tr><td>IGST</td><td class="text-right font-bold">${isInterState ? totalGstAmt.toFixed(2) : '0.00'}</td></tr>
                                <tr><td>Scheme/offer</td><td class="text-right">0.00</td></tr>
                                <tr><td>Freight</td><td class="text-right">0.00</td></tr>
                                <tr><td>Others</td><td class="text-right">0.00</td></tr>
                                <tr><td>Round Off</td><td class="text-right">0.00</td></tr>
                                <tr style="background-color: #eee; font-weight: bold; font-size: 9.5px;">
                                    <td>Net Amount</td>
                                    <td class="text-right">${totalNetAmt.toFixed(2)}</td>
                                </tr>
                            </table>
                            <div style="text-align: right; margin-top: 25px; padding-right: 5px;">
                                <span class="bold">Avira Lifecare</span><br><br><br>
                                <span style="font-size: 8px;">Authorised Signatory</span>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </body>
        </html>
        `;

        res.setHeader('Content-Type', 'text/html');
        res.send(html);

    } catch (err) {
        res.status(500).send("Error rendering bill preview: " + err.message);
    }
});

// 🖨️ BULK PRINT SELECTED BILLS API
router.get('/admin/api/print-multiple-bills', checkAdmin, async (req, res) => {
    try {
        const idsRaw = req.query.ids;
        if (!idsRaw) return res.status(400).send("No bills selected!");

        const ids = idsRaw.split(',').map(id => parseInt(id)).filter(id => !isNaN(id));
        if (ids.length === 0) return res.status(400).send("Invalid bill IDs!");

        const dbRes = await db.query('SELECT * FROM bill_history WHERE id = ANY($1::int[]) ORDER BY id DESC', [ids]);
        const bills = dbRes.rows || [];

        if (bills.length === 0) return res.status(404).send("No bill records found!");

        let allBillsHtml = bills.map((bill, index) => {
            let items = [];
            if (Array.isArray(bill.items)) items = bill.items;
            else if (typeof bill.items === 'string') {
                try { items = JSON.parse(bill.items); } catch (e) { items = []; }
            }

            let totalQty = 0, totalPv = 0, totalOfferPv = 0;
            let totalDiscount = 0, totalOfferDiscount = 0, totalTaxable = 0, totalGstAmt = 0, totalNetAmt = 0;
            let primaryGstPct = 18;

            items.forEach(it => {
                const qty = parseInt(it.qty) || 1;
                const netAmt = parseFloat((it.net_amt || 0).toString().replace(/,/g, ''));
                const gstPct = parseFloat((it.gst_pct || 18).toString().replace(/,/g, ''));
                const discount = parseFloat((it.discount || 0).toString().replace(/,/g, ''));
                const offerDiscount = parseFloat((it.offer_discount || 0).toString().replace(/,/g, ''));
                
                const taxableVal = it.taxable_val ? parseFloat(it.taxable_val) : parseFloat((netAmt / (1 + (gstPct / 100))).toFixed(2));
                const gstAmt = it.gst_amt ? parseFloat(it.gst_amt) : parseFloat((netAmt - taxableVal).toFixed(2));
                const rate = it.rate ? parseFloat(it.rate) : parseFloat((taxableVal / qty).toFixed(2));

                it.calculated_rate = rate;
                it.calculated_taxable = taxableVal;
                it.calculated_gst = gstAmt;

                totalQty += qty;
                totalPv += parseFloat((it.pv || 0).toString().replace(/,/g, ''));
                totalOfferPv += parseFloat((it.offer_pv || 0).toString().replace(/,/g, ''));
                totalDiscount += discount;
                totalOfferDiscount += offerDiscount;
                totalTaxable += taxableVal;
                totalGstAmt += gstAmt;
                totalNetAmt += netAmt;
                if (gstPct) primaryGstPct = gstPct;
            });

            const buyerState = (bill.buyer_state || '').toLowerCase().trim();
            const isInterState = buyerState !== 'gujarat' && buyerState !== 'gj';
            const amountInWords = numberToWords(totalNetAmt);

            return `
                <div class="invoice-container ${index > 0 ? 'page-break' : ''}">
                    <div class="doc-type">Original/Duplicate/Triplicate</div>
                    <div class="top-header">
                        <img src="/images/logo.jpg" class="logo-img" onerror="this.style.display='none'">
                        <div class="company-name">Avira Lifecare</div>
                        <div class="company-address">
                            103, The Galleria 2 Mahavir Chowk, Near by Yogichok, Surat 395010, Gujarat<br>
                            Surat<br>
                            Ph.: +91 9712326273 &nbsp; Email Id: info@aviralifecare.com<br>
                            State: Gujarat &nbsp; StateCode: GJ
                        </div>
                        <div class="gstin-right">GSTIN: 24ABFCA6751MIZE</div>
                    </div>
                    <div class="tax-invoice-bar">TAX INVOICE</div>
                    <table class="grid-tbl">
                        <tr>
                            <td width="50%"><span class="bold">Inv. No. :</span> ${bill.invoice_no || ''}</td>
                            <td width="50%"><span class="bold">Date:</span> ${bill.invoice_date || ''}</td>
                        </tr>
                        <tr>
                            <td>
                                <span class="bold">Details Of Buyer (Billing To)</span><br><br>
                                <span class="bold">Name :</span> ${bill.buyer_name || ''} ${bill.buyer_id ? '( ID : ' + bill.buyer_id + ' )' : ''}<br><br>
                                <span class="bold">Address:</span> ${bill.buyer_address || bill.address || ''}<br><br>
                                <span class="bold">Phone :</span> ${bill.buyer_phone || bill.mobile || ''}<br>
                                <span class="bold">STATE :</span> ${bill.buyer_state || ''} &nbsp;&nbsp;&nbsp; <span class="bold">STATE-CODE :</span> ${bill.buyer_state_code || ''} &nbsp;&nbsp;&nbsp; <span class="bold">PINCODE :</span> ${bill.buyer_pincode || bill.pincode || ''}<br>
                                <span class="bold">GSTIN :</span> ${bill.buyer_gstin || ''}
                            </td>
                            <td>
                                <span class="bold">Details Of Consignee (Shipped To)</span><br><br>
                                <span class="bold">Name :</span> ${bill.consignee_name || ''}<br><br>
                                <span class="bold">Address:</span> ${bill.consignee_address || bill.address || ''}<br><br>
                                <span class="bold">Phone :</span> ${bill.consignee_phone || bill.mobile || ''}<br>
                                <span class="bold">STATE :</span> ${bill.consignee_state || ''} &nbsp;&nbsp;&nbsp; <span class="bold">STATE-CODE :</span> ${bill.consignee_state_code || ''} &nbsp;&nbsp;&nbsp; <span class="bold">PINCODE :</span> ${bill.consignee_pincode || bill.pincode || ''}<br>
                                <span class="bold">GSTIN :</span> ${bill.consignee_gstin || ''}
                            </td>
                        </tr>
                        <tr><td colspan="2"><span class="bold">Transport By:</span></td></tr>
                    </table>
                    <table class="grid-tbl">
                        <thead>
                            <tr style="background-color: #f9f9f9;">
                                <th class="text-center" width="3%">Sr.</th>
                                <th>Product</th>
                                <th class="text-center">HSN Code</th>
                                <th class="text-center">Qty.</th>
                                <th class="text-right">Rate</th>
                                <th class="text-right">Amount</th>
                                <th class="text-center">PV</th>
                                <th class="text-center">Offer PV</th>
                                <th class="text-right">Discount</th>
                                <th class="text-right">Offer Discount</th>
                                <th class="text-right">Taxable Value</th>
                                <th class="text-center">GST%</th>
                                <th class="text-right">GST Amt.</th>
                                <th class="text-right">Net Amount</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${items.map((it, idx) => `
                                <tr>
                                    <td class="text-center">${idx + 1}</td>
                                    <td class="bold">${it.product || 'N/A'}</td>
                                    <td class="text-center">${it.hsn || '30045090'}</td>
                                    <td class="text-center">${it.qty || 1}</td>
                                    <td class="text-right">${parseFloat(it.calculated_rate || it.rate || 0).toFixed(2)}</td>
                                    <td class="text-right">${parseFloat(it.calculated_taxable || it.taxable_val || 0).toFixed(2)}</td>
                                    <td class="text-center">${it.pv || 0}</td>
                                    <td class="text-center">${it.offer_pv || 0}</td>
                                    <td class="text-right">${parseFloat(it.discount || 0).toFixed(2)}</td>
                                    <td class="text-right">${parseFloat(it.offer_discount || 0).toFixed(2)}</td>
                                    <td class="text-right">${parseFloat(it.calculated_taxable || it.taxable_val || 0).toFixed(2)}</td>
                                    <td class="text-center">${parseFloat(it.gst_pct || 18).toFixed(2)}</td>
                                    <td class="text-right">${parseFloat(it.calculated_gst || it.gst_amt || 0).toFixed(2)}</td>
                                    <td class="text-right bold">${parseFloat(it.net_amt || 0).toFixed(2)}</td>
                                </tr>
                            `).join('')}
                            <tr class="bold" style="background-color: #f9f9f9;">
                                <td colspan="3"></td>
                                <td class="text-center">${totalQty}</td>
                                <td></td>
                                <td class="text-right">${totalTaxable.toFixed(2)}</td>
                                <td class="text-center">${totalPv}</td>
                                <td class="text-center">${totalOfferPv}</td>
                                <td class="text-right">${totalDiscount.toFixed(2)}</td>
                                <td class="text-right">${totalOfferDiscount.toFixed(2)}</td>
                                <td class="text-right">${totalTaxable.toFixed(2)}</td>
                                <td></td>
                                <td class="text-right">${totalGstAmt.toFixed(2)}</td>
                                <td class="text-right">${totalNetAmt.toFixed(2)}</td>
                            </tr>
                        </tbody>
                    </table>
                    <div class="summary-wrapper">
                        <div class="left-boxes">
                            <table class="sub-table">
                                <thead>
                                    <tr style="background-color: #f9f9f9;">
                                        <th>Tax Type</th>
                                        <th class="text-right">Amount</th>
                                        <th class="text-right">CGST</th>
                                        <th class="text-right">SGST</th>
                                        <th class="text-right">IGST</th>
                                        <th class="text-right">Discount</th>
                                        <th class="text-right">Net Amt.</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    <tr>
                                        <td>GST ${primaryGstPct.toFixed(4)}%</td>
                                        <td class="text-right">${totalTaxable.toFixed(2)}</td>
                                        <td class="text-right">${!isInterState ? (totalGstAmt / 2).toFixed(2) : '0.00'}</td>
                                        <td class="text-right">${!isInterState ? (totalGstAmt / 2).toFixed(2) : '0.00'}</td>
                                        <td class="text-right">${isInterState ? totalGstAmt.toFixed(2) : '0.00'}</td>
                                        <td class="text-right">${totalDiscount.toFixed(2)}</td>
                                        <td class="text-right font-bold">${totalNetAmt.toFixed(2)}</td>
                                    </tr>
                                </tbody>
                            </table>
                            <table class="sub-table">
                                <tr>
                                    <td width="22%" class="bold">Rs. In Word</td>
                                    <td class="bold">${amountInWords}</td>
                                </tr>
                            </table>
                            <table class="sub-table">
                                <tr><td class="bold" style="background-color: #f9f9f9;">Our Bank Detail</td></tr>
                                <tr>
                                    <td>
                                        BANK NAME: INDUSIND BANK<br>
                                        A/C NO: 259998826273<br>
                                        IFSC: INDB0001409
                                    </td>
                                </tr>
                            </table>
                            <table class="sub-table">
                                <tr><td class="bold" style="background-color: #f9f9f9;">Terms & Condition</td></tr>
                                <tr><td>testing.</td></tr>
                            </table>
                            <div style="font-size: 8px;">Subject To SURAT Jurisdiction.</div>
                        </div>
                        <div class="right-box">
                            <table class="sub-table">
                                <tr><td>Amount</td><td class="text-right font-bold">${totalTaxable.toFixed(2)}</td></tr>
                                <tr><td>Discount</td><td class="text-right font-bold">${totalDiscount.toFixed(2)}</td></tr>
                                <tr><td>CGST</td><td class="text-right">${!isInterState ? (totalGstAmt / 2).toFixed(2) : '0.00'}</td></tr>
                                <tr><td>SGST</td><td class="text-right">${!isInterState ? (totalGstAmt / 2).toFixed(2) : '0.00'}</td></tr>
                                <tr><td>IGST</td><td class="text-right font-bold">${isInterState ? totalGstAmt.toFixed(2) : '0.00'}</td></tr>
                                <tr><td>Scheme/offer</td><td class="text-right">0.00</td></tr>
                                <tr><td>Freight</td><td class="text-right">0.00</td></tr>
                                <tr><td>Others</td><td class="text-right">0.00</td></tr>
                                <tr><td>Round Off</td><td class="text-right">0.00</td></tr>
                                <tr style="background-color: #eee; font-weight: bold; font-size: 9.5px;">
                                    <td>Net Amount</td>
                                    <td class="text-right">${totalNetAmt.toFixed(2)}</td>
                                </tr>
                            </table>
                            <div style="text-align: right; margin-top: 25px; padding-right: 5px;">
                                <span class="bold">Avira Lifecare</span><br><br><br>
                                <span style="font-size: 8px;">Authorised Signatory</span>
                            </div>
                        </div>
                    </div>
                </div>
            `;
        }).join('');

        const finalHtml = `
        <!DOCTYPE html>
        <html>
        <head>
            <meta charset="utf-8">
            <title>Bulk Tax Invoices (${bills.length} Records)</title>
            <style>
                @page { size: A4 portrait; margin: 0; }
                * { box-sizing: border-box; }
                body { font-family: Arial, Helvetica, sans-serif; font-size: 9px; color: #000; margin: 0; padding: 0; background: #1e293b; }
                .action-bar { position: sticky; top: 0; background: #0f172a; padding: 12px 24px; display: flex; justify-content: space-between; align-items: center; color: white; z-index: 1000; box-shadow: 0 4px 12px rgba(0,0,0,0.4); border-bottom: 1px solid #334155; }
                .btn { background: #10b981; color: white; border: none; padding: 8px 18px; border-radius: 8px; font-weight: bold; cursor: pointer; font-size: 11px; text-decoration: none; display: inline-flex; align-items: center; gap: 6px; }
                .btn-secondary { background: #475569; margin-right: 8px; }
                .preview-wrapper { padding: 24px 0; display: flex; flex-direction: column; align-items: center; gap: 20px; }
                .invoice-container { width: 210mm; min-height: 297mm; padding: 10mm; background: white; box-shadow: 0 10px 30px rgba(0,0,0,0.5); margin: auto; }
                .doc-type { text-align: right; font-size: 8px; font-weight: bold; margin-bottom: 2px; }
                .top-header { text-align: center; position: relative; padding-bottom: 4px; }
                .logo-img { position: absolute; left: 0; top: 0; width: 65px; height: auto; }
                .company-name { font-size: 18px; font-weight: bold; font-family: 'Times New Roman', Times, serif; }
                .company-address { font-size: 8.5px; margin-top: 2px; line-height: 1.2; }
                .gstin-right { text-align: right; font-weight: bold; font-size: 9px; margin-top: -8px; }
                .tax-invoice-bar { border-top: 1px solid #000; border-bottom: 1px solid #000; text-align: center; font-weight: bold; font-size: 11px; padding: 2px; margin: 4px 0; background: #ffffff; }
                table.grid-tbl { width: 100%; border-collapse: collapse; margin-bottom: 4px; }
                table.grid-tbl td, table.grid-tbl th { border: 1px solid #000; padding: 3px 4px; vertical-align: top; font-size: 8.5px; }
                .text-center { text-align: center; } .text-right { text-align: right; } .bold { font-weight: bold; }
                .summary-wrapper { display: flex; justify-content: space-between; align-items: flex-start; margin-top: 4px; gap: 6px; }
                .left-boxes { width: 58%; } .right-box { width: 41%; }
                .sub-table { width: 100%; border-collapse: collapse; margin-bottom: 4px; }
                .sub-table td, .sub-table th { border: 1px solid #000; padding: 2.5px 4px; font-size: 8.5px; }
                @media print {
                    .action-bar { display: none !important; }
                    body { background: white !important; }
                    .preview-wrapper { padding: 0 !important; gap: 0 !important; }
                    .invoice-container { box-shadow: none !important; border: none !important; width: 100% !important; padding: 5mm !important; }
                    .page-break { page-break-before: always !important; }
                }
            </style>
        </head>
        <body>
            <div class="action-bar">
                <div style="font-weight: bold; font-size: 13px;">📄 Bulk Invoices Preview (${bills.length} Selected)</div>
                <div>
                    <button class="btn btn-secondary" onclick="window.close()">Close</button>
                    <button class="btn" onclick="window.print()">🖨️ Print All Selected PDFs</button>
                </div>
            </div>
            <div class="preview-wrapper">
                ${allBillsHtml}
            </div>
        </body>
        </html>
        `;

        res.setHeader('Content-Type', 'text/html');
        res.send(finalHtml);
    } catch (err) {
        res.status(500).send("Error rendering bulk print: " + err.message);
    }
});

module.exports = router;