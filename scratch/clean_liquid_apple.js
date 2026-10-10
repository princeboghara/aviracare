const fs = require('fs');
const path = require('path');

// 1. Process confirm_member.ejs
let confirmPath = path.join('views', 'admin', 'confirm_member.ejs');
if (fs.existsSync(confirmPath)) {
    let content = fs.readFileSync(confirmPath, 'utf8');
    // Remove all dark: classes
    content = content.replace(/\s*dark:[a-zA-Z0-9_\-\/\[\]#]+/g, '');
    // Clean up any remaining dark bg hexes
    content = content.replace(/bg-\[#0d1322\](\/\d+)?/g, 'bg-white/80');
    content = content.replace(/bg-\[#0f172a\](\/\d+)?/g, 'bg-white');
    content = content.replace(/bg-\[#0b0f19\](\/\d+)?/g, 'bg-slate-50/80');
    // Elevate cards to glass-apple-card
    content = content.replace(/class="bg-white p-4 rounded-2xl border border-slate-200\/80 shadow-xs/g, 'class="glass-apple-card p-4 rounded-2xl border border-black/5 shadow-xs');
    content = content.replace(/class="bg-white rounded-2xl border border-slate-200\/80 shadow-sm/g, 'class="glass-apple-card rounded-2xl border border-black/5 shadow-xs');
    // Ensure header is glass
    content = content.replace(/<header class="[^"]*"/, '<header class="bg-white/80 backdrop-blur-xl border-b border-black/5 px-4 sm:px-8 py-3.5 flex justify-between items-center sticky top-0 z-40 shadow-xs w-full"');
    fs.writeFileSync(confirmPath, content, 'utf8');
    console.log('✅ Updated confirm_member.ejs');
}

// 2. Process content_manager.ejs
let contentMgrPath = path.join('views', 'admin', 'content_manager.ejs');
if (fs.existsSync(contentMgrPath)) {
    let content = fs.readFileSync(contentMgrPath, 'utf8');
    content = content.replace(/\s*dark:[a-zA-Z0-9_\-\/\[\]#]+/g, '');
    content = content.replace(/bg-\[#0d1322\](\/\d+)?/g, 'bg-white/80');
    content = content.replace(/bg-\[#0f172a\](\/\d+)?/g, 'bg-white');
    content = content.replace(/bg-\[#080c14\](\/\d+)?/g, 'bg-slate-50');
    content = content.replace(/bg-\[#0b0f19\](\/\d+)?/g, 'bg-slate-50/80');
    content = content.replace(/<header class="[^"]*"/, '<header class="bg-white/80 backdrop-blur-xl border-b border-black/5 px-4 sm:px-8 py-3.5 flex justify-between items-center sticky top-0 z-40 shadow-xs w-full"');
    content = content.replace(/class="bg-white p-4 rounded-2xl border border-slate-200\/80 shadow-xs/g, 'class="glass-apple-card p-4 rounded-2xl border border-black/5 shadow-xs');
    content = content.replace(/class="bg-white p-5 sm:p-7 rounded-3xl border border-slate-200\/80 shadow-sm/g, 'class="glass-apple-card p-5 sm:p-7 rounded-3xl border border-black/5 shadow-xs');
    content = content.replace(/class="bg-white rounded-3xl border border-slate-200\/80 shadow-sm/g, 'class="glass-apple-card rounded-3xl border border-black/5 shadow-xs');
    fs.writeFileSync(contentMgrPath, content, 'utf8');
    console.log('✅ Updated content_manager.ejs');
}

// 3. Process master_database.ejs
let masterDbPath = path.join('views', 'admin', 'master_database.ejs');
if (fs.existsSync(masterDbPath)) {
    let content = fs.readFileSync(masterDbPath, 'utf8');
    content = content.replace(/\s*dark:[a-zA-Z0-9_\-\/\[\]#]+/g, '');
    content = content.replace(/bg-\[#0d1322\](\/\d+)?/g, 'bg-white/80');
    content = content.replace(/bg-\[#111827\](\/\d+)?/g, 'bg-white');
    content = content.replace(/<header class="[^"]*"/, '<header class="bg-white/80 backdrop-blur-xl border-b border-black/5 px-4 sm:px-8 py-3.5 flex justify-between items-center sticky top-0 z-40 shadow-xs w-full"');
    content = content.replace(/class="bg-gradient-to-br from-slate-50 to-emerald-50\/30 min-h-screen flex flex-col font-sans antialiased text-slate-800"/, 'class="bg-mesh-emerald min-h-screen flex flex-col font-sans antialiased text-slate-800"');
    content = content.replace(/class="bg-white p-4 rounded-2xl border border-slate-100 shadow-md/g, 'class="glass-apple-card p-4 rounded-2xl border border-black/5 shadow-xs');
    content = content.replace(/class="bg-white rounded-2xl border border-slate-100 shadow-lg/g, 'class="glass-apple-card rounded-2xl border border-black/5 shadow-xs');
    // Modal overhaul
    content = content.replace(/id="editMasterModal" class="[^"]*"/, 'id="editMasterModal" class="fixed inset-0 bg-black/20 backdrop-blur-md hidden items-center justify-center z-50 p-4"');
    content = content.replace(/<div class="bg-white rounded-2xl shadow-xl w-full max-w-lg border border-slate-100 overflow-hidden">/, '<div class="apple-glass-modal w-full max-w-lg overflow-hidden">');
    content = content.replace(/<div class="bg-slate-900 px-6 py-4 text-white flex justify-between items-center">/, '<div class="apple-modal-header px-6 py-4 flex justify-between items-center text-slate-900">');
    // Footer overhaul
    content = content.replace(/<footer class="[^"]*"/, '<footer class="bg-white/80 backdrop-blur-md border-t border-black/5 py-4 text-center text-xs font-medium text-slate-400"');
    fs.writeFileSync(masterDbPath, content, 'utf8');
    console.log('✅ Updated master_database.ejs');
}

// 4. Process manual_entry.ejs
let manualEntryPath = path.join('views', 'admin', 'manual_entry.ejs');
if (fs.existsSync(manualEntryPath)) {
    let content = fs.readFileSync(manualEntryPath, 'utf8');
    content = content.replace(/\s*dark:[a-zA-Z0-9_\-\/\[\]#]+/g, '');
    content = content.replace(/bg-\[#0f172a\](\/\d+)?/g, 'bg-white');
    content = content.replace(/id="ocrStatusBox" class="hidden bg-slate-900 text-white/g, 'id="ocrStatusBox" class="hidden glass-apple-card border border-emerald-500/30 text-slate-900');
    content = content.replace(/id="exportExcelBtn" class="bg-slate-900 hover:bg-slate-950 text-white/g, 'id="exportExcelBtn" class="btn-emerald-3d text-white');
    content = content.replace(/id="newConsignmentModal" class="hidden fixed inset-0 z-50 overflow-y-auto bg-slate-900\/60 backdrop-blur-xs/g, 'id="newConsignmentModal" class="hidden fixed inset-0 z-50 overflow-y-auto bg-black/20 backdrop-blur-md');
    content = content.replace(/<div class="bg-white w-full max-w-md rounded-2xl shadow-2xl border border-slate-100 overflow-hidden transform transition-all">/g, '<div class="apple-glass-modal w-full max-w-md overflow-hidden transform transition-all">');
    fs.writeFileSync(manualEntryPath, content, 'utf8');
    console.log('✅ Updated manual_entry.ejs');
}

// 5. Process settings.ejs & tracking.ejs
let settingsPath = path.join('views', 'admin', 'settings.ejs');
if (fs.existsSync(settingsPath)) {
    let content = fs.readFileSync(settingsPath, 'utf8');
    content = content.replace(/bg-slate-900 hover:bg-slate-950 text-white/g, 'btn-emerald-3d text-white');
    fs.writeFileSync(settingsPath, content, 'utf8');
    console.log('✅ Updated settings.ejs');
}

let trackingAdminPath = path.join('views', 'admin', 'tracking.ejs');
if (fs.existsSync(trackingAdminPath)) {
    let content = fs.readFileSync(trackingAdminPath, 'utf8');
    content = content.replace(/bg-slate-900 hover:bg-slate-950 text-white/g, 'btn-emerald-3d text-white');
    fs.writeFileSync(trackingAdminPath, content, 'utf8');
    console.log('✅ Updated admin tracking.ejs');
}

// 6. Process view_products.ejs
let viewProductsPath = path.join('views', 'admin', 'view_products.ejs');
if (fs.existsSync(viewProductsPath)) {
    let content = fs.readFileSync(viewProductsPath, 'utf8');
    content = content.replace(/bg-slate-950\/40 backdrop-blur-sm/g, 'bg-black/20 backdrop-blur-md');
    fs.writeFileSync(viewProductsPath, content, 'utf8');
    console.log('✅ Updated view_products.ejs');
}

// 7. Process member/tracking.ejs, member/product_detail.ejs, member/products.ejs
let memberTrackingPath = path.join('views', 'member', 'tracking.ejs');
if (fs.existsSync(memberTrackingPath)) {
    let content = fs.readFileSync(memberTrackingPath, 'utf8');
    content = content.replace(/bg-slate-900\/70 backdrop-blur-xs/g, 'bg-black/20 backdrop-blur-md');
    fs.writeFileSync(memberTrackingPath, content, 'utf8');
    console.log('✅ Updated member tracking.ejs');
}

let memberProductDetailPath = path.join('views', 'member', 'product_detail.ejs');
if (fs.existsSync(memberProductDetailPath)) {
    let content = fs.readFileSync(memberProductDetailPath, 'utf8');
    content = content.replace(/bg-slate-900 text-white/g, 'bg-emerald-50 text-emerald-700 border border-emerald-200');
    fs.writeFileSync(memberProductDetailPath, content, 'utf8');
    console.log('✅ Updated member product_detail.ejs');
}

let memberProductsPath = path.join('views', 'member', 'products.ejs');
if (fs.existsSync(memberProductsPath)) {
    let content = fs.readFileSync(memberProductsPath, 'utf8');
    content = content.replace(/bg-slate-950\/80 backdrop-blur-md text-white/g, 'bg-white/80 backdrop-blur-md text-slate-900 border border-black/10');
    content = content.replace(/bg-slate-950\/20/g, 'bg-black/10');
    content = content.replace(/bg-slate-950\/5/g, 'bg-black/5');
    fs.writeFileSync(memberProductsPath, content, 'utf8');
    console.log('✅ Updated member products.ejs');
}
