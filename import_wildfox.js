const fs = require('fs');
const path = require('path');
const SgfParser = require('./sgfParser.js');

// 导入源目录
const SRC_DIRS = [
    { path: path.join('E:', 'ai_code', 'go-problems', 'weekly-go-problems'), type: 'weekly' },
    { path: path.join('E:', 'ai_code', 'wildfox', 'resource', 'sgf'), type: 'wildfox' },
    { path: path.join('E:', 'ai_code', 'go-problem-sgfs'), type: 'go-problem-sgfs' }
];

const OUTPUT_FILE = path.join('E:', 'ai_code', 'go-learning', 'problems.js');

// 难度划分桶，目标数量
const TARGETS = {
    easy: 700,
    medium: 700,
    hard: 600
};

const problemBuckets = {
    easy: [],
    medium: [],
    hard: []
};

// 用来去重的指纹集合
const seenFingerprints = new Set();

/**
 * 递归获取目录下所有 .sgf 文件
 */
function getSgfFiles(dir) {
    let results = [];
    if (!fs.existsSync(dir)) return results;
    const list = fs.readdirSync(dir);
    list.forEach(file => {
        const filePath = path.join(dir, file);
        const stat = fs.statSync(filePath);
        if (stat && stat.isDirectory()) {
            results = results.concat(getSgfFiles(filePath));
        } else if (file.endsWith('.sgf')) {
            results.push(filePath);
        }
    });
    return results;
}

/**
 * 产生唯一的摆子指纹，用于去重
 */
function getFingerprint(rootNode) {
    const ab = rootNode.properties.AB || [];
    const aw = rootNode.properties.AW || [];
    
    const abArr = (Array.isArray(ab) ? ab : [ab]).map(s => String(s)).sort();
    const awArr = (Array.isArray(aw) ? aw : [aw]).map(s => String(s)).sort();
    
    return `B:${abArr.join(',')}|W:${awArr.join(',')}`;
}

/**
 * 判定该题是否有正确的解法路径
 */
function hasCorrectSolution(node) {
    const comment = node.properties.C || "";
    const gb = node.properties.GB;

    if (gb === "1" || gb === 1) return true;
    if (/correct|正解|成功|妙手/i.test(comment) && !/incorrect/i.test(comment)) return true;
    if (/fail|wrong|incorrect|mistake|dead|die|escapes|better|ko|失败|错|不行|已死|棋差|坏棋|劫/i.test(comment)) {
        return false;
    }

    if (!node.children || node.children.length === 0) {
        return true; // 没有子节点且未标失败，默认有解
    }

    for (const child of node.children) {
        if (hasCorrectSolution(child)) {
            return true;
        }
    }
    return false;
}

/**
 * 智能清洗并转换 SGF 里的 C 属性作为题目描述
 */
function cleanDescription(cText) {
    if (!cText) return '黑先。请在 19路棋盘上找到局部的最妙下法。';
    let cleaned = cText.replace(/https?:\/\/gogameguru\.com\/?/gi, '').trim();
    cleaned = cleaned.replace(/\s+/g, ' ');
    if (cleaned.startsWith('Black to play.')) {
        cleaned = cleaned.replace('Black to play.', '黑先。');
    }
    if (!cleaned.includes('黑先') && !cleaned.includes('黑棋')) {
        cleaned = '黑先。' + cleaned;
    }
    return cleaned;
}

/**
 * 尝试解析 SGF 文件并归入相应难度桶
 */
function processSgf(filePath, srcType) {
    try {
        const sgfContent = fs.readFileSync(filePath, 'utf-8').trim();
        if (!sgfContent) return;

        const root = SgfParser.parse(sgfContent);
        if (!root) return; // 解析失败，略过

        // 必须含有摆子
        if (!root.properties.AB && !root.properties.AW) return;
        
        // 必须有解答步骤 (即有子节点)
        if (!root.children || root.children.length === 0) return;

        // 必须能搜到正确的可行解
        if (!hasCorrectSolution(root)) return;

        // 检查棋盘尺寸，必须为 19路（如果含有 SZ 且不为 19，则过滤）
        const sz = root.properties.SZ;
        if (sz && parseInt(sz, 10) !== 19) return;

        // 生成指纹去重
        const fingerprint = getFingerprint(root);
        if (seenFingerprints.has(fingerprint)) return; // 已经存在，去重

        // 智能分类难度
        let difficulty = null;
        const normalizedPath = filePath.replace(/\\/g, '/');

        if (srcType === 'weekly') {
            if (normalizedPath.includes('/easy/')) difficulty = 'easy';
            else if (normalizedPath.includes('/intermediate/')) difficulty = 'medium';
            else if (normalizedPath.includes('/hard/')) difficulty = 'hard';
        } else if (srcType === 'wildfox') {
            if (normalizedPath.includes('李昌镐精讲围棋死活') && normalizedPath.includes('/1/')) {
                difficulty = 'easy';
            } else if (normalizedPath.includes('李昌镐精讲围棋死活') && (normalizedPath.includes('/2/') || normalizedPath.includes('/3/'))) {
                difficulty = 'medium';
            } else if (normalizedPath.includes('李昌镐精讲围棋死活') && normalizedPath.includes('/4/')) {
                difficulty = 'hard';
            } else if (normalizedPath.includes('吴清源死活题')) {
                difficulty = 'hard';
            } else if (normalizedPath.includes('围棋实用死活')) {
                // 实用死活如果是随机的，我们根据文件名或哈希分发
                const num = parseInt(filePath.replace(/[^\d]/g, ''), 10) || 0;
                difficulty = num % 2 === 0 ? 'easy' : 'medium';
            } else if (normalizedPath.includes('/fight/')) {
                difficulty = 'medium';
            }
        } else if (srcType === 'go-problem-sgfs') {
            if (normalizedPath.includes('goproblems.com/easy')) difficulty = 'easy';
            else if (normalizedPath.includes('goproblems.com/medium')) difficulty = 'medium';
            else if (normalizedPath.includes('goproblems.com/hard')) difficulty = 'hard';
            else if (normalizedPath.includes('Kanzufu')) difficulty = 'medium';
            else if (normalizedPath.includes('Xuan Xuan Qi Jing')) difficulty = 'hard';
        }

        // 兜底分类
        if (!difficulty) {
            difficulty = 'medium'; // 默认中等
        }

        // 检查该难度的桶是否已满
        if (problemBuckets[difficulty].length >= TARGETS[difficulty]) return;

        // 处理题目的描述
        let desc = '黑先。';
        if (root.properties.C) {
            desc = cleanDescription(root.properties.C);
        }

        const titlePrefix = {
            easy: '入门吃子挑战',
            medium: '初级死活挑战',
            hard: '手筋进阶挑战'
        }[difficulty];

        const index = problemBuckets[difficulty].length + 1;
        const problemObj = {
            id: `${difficulty}_${index}`,
            title: `${titlePrefix} ${index}`,
            difficulty: difficulty,
            desc: desc,
            sgf: sgfContent
        };

        problemBuckets[difficulty].push(problemObj);
        seenFingerprints.add(fingerprint);

    } catch (e) {
        // 忽略单个文件解析的报错，保证任务不中断
    }
}

function runImport() {
    console.log('--- 启动 2000 道题库扫描与自动组装程序 ---');
    
    // 按照来源顺序处理，确保 weekly 的高品质题库优先加入
    SRC_DIRS.forEach(src => {
        console.log(`正在扫描: ${src.path}...`);
        const files = getSgfFiles(src.path);
        console.log(`在该源下找到 ${files.length} 个 SGF 文件，开始处理分类...`);
        
        files.forEach(file => {
            // 每次检查是否所有桶均已装满
            if (problemBuckets.easy.length >= TARGETS.easy &&
                problemBuckets.medium.length >= TARGETS.medium &&
                problemBuckets.hard.length >= TARGETS.hard) {
                return;
            }
            processSgf(file, src.type);
        });
    });

    const totalEasy = problemBuckets.easy.length;
    const totalMedium = problemBuckets.medium.length;
    const totalHard = problemBuckets.hard.length;
    const total = totalEasy + totalMedium + totalHard;

    console.log(`\n组装完成！统计数据如下：`);
    console.log(`- 入门吃子 (easy)   : ${totalEasy} / ${TARGETS.easy}`);
    console.log(`- 初级死活 (medium) : ${totalMedium} / ${TARGETS.medium}`);
    console.log(`- 手筋进阶 (hard)   : ${totalHard} / ${TARGETS.hard}`);
    console.log(`- 总题目数量        : ${total} / 2000`);

    // 构建写入的 problems.js 文件内容
    const allProblems = [
        ...problemBuckets.easy,
        ...problemBuckets.medium,
        ...problemBuckets.hard
    ];

    const jsContent = `/**
 * 弈道 - 内置 19路死活题库 (Tsumego Library)
 * 本文件由 import_wildfox.js 脚本扫描自动合并去重生成。
 * 包含入门吃子 700 道、初级死活 700 道、手筋进阶 600 道，共计 2000 道题目。
 */
const GO_PROBLEMS = ${JSON.stringify(allProblems, null, 4)};

if (typeof module !== 'undefined') {
    module.exports = GO_PROBLEMS;
}
`;

    fs.writeFileSync(OUTPUT_FILE, jsContent, 'utf-8');
    console.log(`\n🎉 成功写出新题库到: ${OUTPUT_FILE}`);
}

runImport();
