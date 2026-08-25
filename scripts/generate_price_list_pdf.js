const fs = require('fs');
const path = require('path');
const PDFDocument = require('pdfkit');

// List of all products matching the exact template image + agriculture products at the bottom
const priceListData = [
    { sn: 1, name: "Multi Vitamin Capsule", volume: "30 tab", oldMrp: "2000", mrp: "1799 RS", pv: "300 PV", isRedMrp: true },
    { sn: 2, name: "Maxx Power Capsule", volume: "30 tab", oldMrp: "2000", mrp: "1799 RS", pv: "300 PV", isRedMrp: true },
    { sn: 3, name: "Jeevan Amrut", volume: "30 ml", oldMrp: null, mrp: "599 RS", pv: "100 PV" },
    { sn: 4, name: "Protein Powder", volume: "300 gm", oldMrp: null, mrp: "799 RS", pv: "130 PV" },
    { sn: 5, name: "Women Special Powder", volume: "300 gm", oldMrp: null, mrp: "799 RS", pv: "130 PV" },
    { sn: 6, name: "Choco Brain Powder", volume: "250 gm", oldMrp: null, mrp: "599 RS", pv: "100 PV" },
    { sn: 7, name: "Pineapple Energy Drink", volume: "300 gm", oldMrp: null, mrp: "599 RS", pv: "100 PV" },
    { sn: 8, name: "Milky Shampoo", volume: "300 ml", oldMrp: null, mrp: "499 RS", pv: "100 PV" },
    { sn: 9, name: "Tea Tree Shampoo", volume: "300 ml", oldMrp: null, mrp: "399 RS", pv: "50 PV" },
    { sn: 10, name: "24 Herbs Shampoo", volume: "300 ml", oldMrp: null, mrp: "499 RS", pv: "100 PV" },
    { sn: 11, name: "Daily Moisturizing Body Wash", volume: "300 ml", oldMrp: null, mrp: "499 RS", pv: "80 PV" },
    { sn: 12, name: "34 - Herbs Hair oil", volume: "100 ml", oldMrp: null, mrp: "499 RS", pv: "90 PV" },
    { sn: 13, name: "Onion Hair Oil", volume: "100 ml", oldMrp: null, mrp: "399 RS", pv: "50 PV" },
    { sn: 14, name: "Pain Relief Gel", volume: "100 gm", oldMrp: null, mrp: "199 RS", pv: "20 PV" },
    { sn: 15, name: "Herbal Body Wax Powder", volume: "100 gm", oldMrp: null, mrp: "499 RS", pv: "100 PV" },
    { sn: 16, name: "Rose Soap", volume: "100 gm", oldMrp: null, mrp: "99 RS", pv: "12 PV" },
    { sn: 17, name: "Neem Tulsi Soap", volume: "100 gm", oldMrp: null, mrp: "99 RS", pv: "12 PV" },
    { sn: 18, name: "Lavender Soap", volume: "100 gm", oldMrp: null, mrp: "99 RS", pv: "12 PV" },
    { sn: 19, name: "Sleepy Soap", volume: "100 gm", oldMrp: null, mrp: "99 RS", pv: "12 PV" },
    { sn: 20, name: "5 in 1 Face Wash", volume: "100 ml", oldMrp: null, mrp: "299 RS", pv: "30 PV" },
    { sn: 21, name: "Niacinamide Face Wash", volume: "100 ml", oldMrp: null, mrp: "399 RS", pv: "55 PV" },
    { sn: 22, name: "De-Addiction", volume: "100 ml", oldMrp: "999", mrp: "599 RS", pv: "125 PV", isRedMrp: true },
    { sn: 23, name: "Black Mahendi", volume: "25 gm", oldMrp: null, mrp: "120 RS", pv: "15 PV" },
    { sn: 24, name: "Brown Mahendi", volume: "25 gm", oldMrp: null, mrp: "120 RS", pv: "15 PV" },
    { sn: 25, name: "Neemadent Toothpaste", volume: "150 gm", oldMrp: null, mrp: "129 RS", pv: "15 PV" },
    { sn: 26, name: "Premium Tea Leaves", volume: "250 gm", oldMrp: null, mrp: "349 RS", pv: "40 PV" },
    { sn: 27, name: "Night Cream", volume: "50 gm", oldMrp: null, mrp: "599 RS", pv: "100 PV" },
    { sn: 28, name: "Avira Carbonx", volume: "1 KG", oldMrp: null, mrp: "799 RS", pv: "135 PV" },
    { sn: 29, name: "Salicylic Acid Face Cleanser", volume: "100 ml", oldMrp: null, mrp: "699 RS", pv: "110 PV" },
    { sn: 30, name: "Diabetic Powder", volume: "200 gm", oldMrp: null, mrp: "799 RS", pv: "105 PV" },
    { sn: 31, name: "Green Tea Tablet", volume: "30 Tab.", oldMrp: null, mrp: "799 RS", pv: "110 PV" },
    { sn: 32, name: "Fat Loss Capsule", volume: "30 Cap.", oldMrp: null, mrp: "799 RS", pv: "110 PV" },
    { sn: 33, name: "Detox Capsule", volume: "30 Cap.", oldMrp: null, mrp: "599 RS", pv: "80 PV" },
    { sn: 34, name: "Sanitary Napkins", volume: "8 Pads", oldMrp: null, mrp: "125 RS", pv: "20 PV" },
    { sn: 35, name: "Faminor Juice", volume: "500 ml", oldMrp: null, mrp: "1299 RS", pv: "200 PV" },
    { sn: 36, name: "Sea Buckthorn Juice", volume: "500 ml", oldMrp: "1799", mrp: "1299 RS", pv: "200 PV", isRedMrp: true },
    // 🌾 Agriculture Products added below
    { sn: 37, name: "Avira Bloom +", volume: "100 ml", oldMrp: null, mrp: "415 RS", pv: "40 PV" },
    { sn: 38, name: "Avira Bloom +", volume: "250 ml", oldMrp: null, mrp: "810 RS", pv: "100 PV" },
    { sn: 39, name: "Plant Growth Promoter", volume: "250 ml", oldMrp: null, mrp: "375 RS", pv: "40 PV" },
    { sn: 40, name: "Avira 82ST", volume: "100 ml", oldMrp: null, mrp: "440 RS", pv: "40 PV" },
    { sn: 41, name: "Avira 82ST", volume: "250 ml", oldMrp: null, mrp: "715 RS", pv: "80 PV" },
    { sn: 42, name: "Bhumi Sanjivani", volume: "250 gm", oldMrp: null, mrp: "625 RS", pv: "60 PV" }
];

function generateAviraExactPriceList(outputPath, stream = null) {
    const doc = new PDFDocument({
        margin: 16,
        size: 'A4',
        info: {
            Title: 'AVIRA LIFECARE - PRODUCT PRICE LIST',
            Author: 'Avira Lifecare Global Private Limited',
            Subject: 'Official Product Catalogue with Volume, MRP, and PV Details'
        }
    });

    if (stream) {
        doc.pipe(stream);
    } else if (outputPath) {
        const writeStream = fs.createWriteStream(outputPath);
        writeStream.on('error', (err) => {
            console.warn(`File write warning for ${outputPath}:`, err.message);
        });
        doc.pipe(writeStream);
    }

    const pageWidth = 595.28;
    const pageHeight = 841.89;
    const margin = 16;
    const contentWidth = pageWidth - (margin * 2); // 563.28

    // Outer double border
    doc.rect(margin, margin, contentWidth, pageHeight - (margin * 2)).lineWidth(1.5).stroke('#000000');
    doc.rect(margin + 2.5, margin + 2.5, contentWidth - 5, pageHeight - (margin * 2) - 5).lineWidth(0.5).stroke('#000000');

    // Header section
    const logoPath = path.join(__dirname, '../public/images/logo.jpg');
    if (fs.existsSync(logoPath)) {
        try {
            doc.image(logoPath, margin + 14, margin + 8, { width: 56, height: 48, fit: [56, 48] });
        } catch (e) {
            console.warn("Logo load error:", e.message);
        }
    }

    // Header Text
    doc.fillColor('#0d3b1e') // Forest green
       .font('Helvetica-Bold')
       .fontSize(21)
       .text('AVIRA LIFECARE', margin + 60, margin + 10, { width: contentWidth - 80, align: 'center' });

    doc.fillColor('#1e3a8a') // Deep Blue
       .font('Helvetica-Bold')
       .fontSize(12.5)
       .text('PRODUCT PRICE LIST', margin + 60, margin + 34, { width: contentWidth - 80, align: 'center' });

    doc.fillColor('#334155') // Slate Gray
       .font('Helvetica')
       .fontSize(8)
       .text('Official Product Catalogue with Volume, MRP, and PV Details', margin + 60, margin + 49, { width: contentWidth - 80, align: 'center' });

    // Underline divider below header
    const headerBottomY = margin + 62;
    doc.moveTo(margin + 2.5, headerBottomY).lineTo(margin + contentWidth - 2.5, headerBottomY).lineWidth(1.2).stroke('#000000');

    // Table Column Dimensions
    const colWidths = {
        sn: 42,
        name: 220,
        volume: 95,
        mrp: 110,
        pv: 96.28
    };

    const colX = {
        sn: margin + 2.5,
        name: margin + 2.5 + colWidths.sn,
        volume: margin + 2.5 + colWidths.sn + colWidths.name,
        mrp: margin + 2.5 + colWidths.sn + colWidths.name + colWidths.volume,
        pv: margin + 2.5 + colWidths.sn + colWidths.name + colWidths.volume + colWidths.mrp
    };

    const tableTop = headerBottomY;
    const tableHeaderHeight = 18;

    // Draw Table Header Bar (Black/Dark Green background)
    doc.rect(margin + 2.5, tableTop, contentWidth - 5, tableHeaderHeight).fill('#0a2412');

    // Table Header Text
    doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(8.5);
    doc.text('S.N.', colX.sn, tableTop + 5, { width: colWidths.sn, align: 'center' });
    doc.text('PRODUCT NAME', colX.name, tableTop + 5, { width: colWidths.name, align: 'center' });
    doc.text('VOLUME', colX.volume, tableTop + 5, { width: colWidths.volume, align: 'center' });
    doc.text('MRP', colX.mrp, tableTop + 5, { width: colWidths.mrp, align: 'center' });
    doc.text('PV', colX.pv, tableTop + 5, { width: colWidths.pv, align: 'center' });

    // Header vertical borders
    const headerLines = [colX.name, colX.volume, colX.mrp, colX.pv];
    headerLines.forEach(x => {
        doc.moveTo(x, tableTop).lineTo(x, tableTop + tableHeaderHeight).lineWidth(0.5).stroke('#ffffff');
    });

    let currentY = tableTop + tableHeaderHeight;
    const totalRows = priceListData.length;
    const availableHeight = (pageHeight - margin - 3) - currentY;
    const rowHeight = availableHeight / totalRows; // exactly fits all 42 rows on 1 page!

    // Alternating Row Background Colors matching exact template
    const rowBgColor1 = '#d9ead3'; // Light green tint
    const rowBgColor2 = '#edf7e8'; // Very pale green tint

    priceListData.forEach((item, index) => {
        const isAlternate = (index % 2 === 1);
        const bg = isAlternate ? rowBgColor2 : rowBgColor1;

        // Row background
        doc.rect(margin + 2.5, currentY, contentWidth - 5, rowHeight).fill(bg);

        // Row border bottom
        doc.moveTo(margin + 2.5, currentY + rowHeight)
           .lineTo(margin + contentWidth - 2.5, currentY + rowHeight)
           .lineWidth(0.4)
           .stroke('#94a3b8');

        const textY = currentY + (rowHeight / 2) - 4;

        // 1. S.N.
        doc.fillColor('#000000')
           .font('Helvetica-Bold')
           .fontSize(7.5)
           .text(item.sn.toString(), colX.sn, textY, { width: colWidths.sn, align: 'center' });

        // 2. PRODUCT NAME (Centered bold black)
        doc.fillColor('#000000')
           .font('Helvetica-Bold')
           .fontSize(7.5)
           .text(item.name, colX.name + 4, textY, { width: colWidths.name - 8, align: 'center' });

        // 3. VOLUME
        doc.fillColor('#000000')
           .font('Helvetica-Bold')
           .fontSize(7.5)
           .text(item.volume, colX.volume, textY, { width: colWidths.volume, align: 'center' });

        // 4. MRP (With Strikethrough if discounted, e.g. 2000 1799 RS)
        if (item.oldMrp) {
            const oldText = `${item.oldMrp} `;
            const newText = item.mrp;
            
            doc.font('Helvetica-Bold').fontSize(7.5);
            const oldWidth = doc.widthOfString(oldText);
            const newWidth = doc.widthOfString(newText);
            const totalWidth = oldWidth + newWidth;
            const startX = colX.mrp + (colWidths.mrp - totalWidth) / 2;

            // Old Price
            doc.fillColor('#000000')
               .text(oldText, startX, textY, { lineBreak: false });
            // Draw strike line
            doc.moveTo(startX, textY + 4)
               .lineTo(startX + oldWidth - 3, textY + 4)
               .lineWidth(0.8)
               .stroke('#000000');

            // New Price in Red
            doc.fillColor('#dc2626') // Red
               .text(newText, startX + oldWidth, textY, { lineBreak: false });
        } else {
            doc.fillColor('#000000')
               .font('Helvetica-Bold')
               .fontSize(7.5)
               .text(item.mrp, colX.mrp, textY, { width: colWidths.mrp, align: 'center' });
        }

        // 5. PV
        doc.fillColor('#000000')
           .font('Helvetica-Bold')
           .fontSize(7.5)
           .text(item.pv, colX.pv, textY, { width: colWidths.pv, align: 'center' });

        // Vertical column dividers for each row
        headerLines.forEach(x => {
            doc.moveTo(x, currentY)
               .lineTo(x, currentY + rowHeight)
               .lineWidth(0.3)
               .stroke('#94a3b8');
        });

        currentY += rowHeight;
    });

    doc.end();
    return doc;
}

if (require.main === module) {
    const publicOut = path.join(__dirname, '../public/downloads/AviraCare_Product_Price_List.pdf');
    const defaultOut = path.join(__dirname, '../AviraCare_Product_Price_List.pdf');

    const dir = path.dirname(publicOut);
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }

    try {
        generateAviraExactPriceList(publicOut);
        console.log(`✅ Generated: ${publicOut}`);
    } catch (e) {
        console.warn(e.message);
    }

    try {
        generateAviraExactPriceList(defaultOut);
        console.log(`✅ Generated: ${defaultOut}`);
    } catch (e) {
        console.warn(e.message);
    }
}

module.exports = { generateAviraExactPriceList, priceListData };
