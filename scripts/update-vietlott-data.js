// Script này chạy TỰ ĐỘNG trên máy chủ GitHub Actions. Vietlott.vn được bảo vệ bởi trang kiểm
// tra chống-bot của Cloudflare (yêu cầu chạy JavaScript thật để xác nhận là trình duyệt thật),
// nên không thể lấy dữ liệu bằng fetch() đơn thuần — phải dùng Playwright để mở 1 trình duyệt ẩn
// (headless Chromium) thật sự, để nó tự vượt qua bài kiểm tra đó như người dùng bình thường.
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const GAMES = {
    mega645: '645',
    power655: '655',
    lotto535: '535',
    max3d: 'max-3d',
    max3dpro: 'max-3dpro',
    max3dplus: 'max-3d' // Vietlott không có trang riêng cho Max3D+, dùng chung trang Max 3D
};

function parseResultHtml(html, gameType) {
    const anchorIdx = html.indexOf('day_so_ket_qua');
    if (anchorIdx === -1) throw new Error('Không tìm thấy khối kết quả trong trang (có thể vẫn đang ở trang kiểm tra chống-bot)');
    const windowHtml = html.substring(anchorIdx, anchorIdx + 2000);

    const ballMatches = [...windowHtml.matchAll(/bong_tron[^"]*">\s*(\d+)\s*</g)].map(m => m[1]);
    if (ballMatches.length < 1) throw new Error('Không đọc được số kết quả từ trang');

    let numbers;
    if (gameType.startsWith('max3d')) {
        const digits = ballMatches.join('');
        const triplets = [];
        for (let i = 0; i <= digits.length - 3; i += 3) triplets.push(digits.substring(i, i + 3));
        numbers = gameType === 'max3d' ? triplets.slice(0, 1) : triplets.slice(0, 2);
    } else {
        numbers = ballMatches.map(n => parseInt(n, 10));
    }

    const idMatch = html.match(/[Kk]ỳ quay(?: thưởng)?\s*<b>#?(\d+)<\/b>\s*ngày\s*<b>([\d\/]+)<\/b>/);
    if (!idMatch) throw new Error('Không đọc được mã kỳ quay / ngày quay');

    return { id: `#${idMatch[1]}`, date: idMatch[2], numbers };
}

async function fetchGame(browser, gameType, resultPath) {
    const targetUrl = `https://vietlott.vn/vi/trung-thuong/ket-qua-trung-thuong/${resultPath}`;
    const context = await browser.newContext({
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        locale: 'vi-VN'
    });
    const page = await context.newPage();
    try {
        await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
        // Đợi thêm để trang kiểm tra chống-bot (nếu xuất hiện) tự chạy xong và chuyển sang trang thật
        await page.waitForTimeout(6000);
        const html = await page.content();
        return parseResultHtml(html, gameType);
    } finally {
        await context.close();
    }
}

function mergeById(existing, newDraw) {
    const byId = {};
    [newDraw, ...existing].forEach(d => { if (d && d.id) byId[d.id] = d; });
    return Object.values(byId).sort((a, b) => {
        const na = parseInt(String(a.id).replace(/\D/g, ''), 10) || 0;
        const nb = parseInt(String(b.id).replace(/\D/g, ''), 10) || 0;
        return nb - na;
    }).slice(0, 200); // giữ tối đa 200 kỳ gần nhất mỗi loại hình
}

async function main() {
    const dataDir = path.join(__dirname, '..', 'data');
    if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

    const browser = await chromium.launch();

    for (const [gameType, resultPath] of Object.entries(GAMES)) {
        const filePath = path.join(dataDir, `${gameType}.json`);
        let existing = [];
        if (fs.existsSync(filePath)) {
            try { existing = JSON.parse(fs.readFileSync(filePath, 'utf8')); } catch (e) { existing = []; }
        }

        try {
            const draw = await fetchGame(browser, gameType, resultPath);
            const merged = mergeById(existing, draw);
            fs.writeFileSync(filePath, JSON.stringify(merged, null, 2), 'utf8');
            console.log(`[OK] ${gameType}: kỳ mới nhất ${draw.id} (${draw.date}) — tổng ${merged.length} kỳ đang lưu`);
        } catch (e) {
            console.warn(`[SKIP] ${gameType}: ${e.message}`);
        }

        // Nghỉ giữa các lượt để không gây tải dồn dập lên vietlott.vn
        await new Promise(r => setTimeout(r, 2000));
    }

    await browser.close();
}

main().catch(err => {
    console.error(err);
    process.exit(1);
});
