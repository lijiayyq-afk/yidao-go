const fs = require('fs');
const path = require('path');
const SgfParser = require('./sgfParser.js');

// 路径定义
const GO_PROBLEMS_DIR = path.join('E:', 'ai_code', 'go-problems', 'weekly-go-problems');
const OUTPUT_FILE = path.join('E:', 'ai_code', 'go-learning', 'problems.js');

// 难度的中文映射与路径配置
const CONFIGS = [
    {
        dir: 'easy',
        difficulty: 'easy',
        cnName: '入门吃子',
        count: 30
    },
    {
        dir: 'intermediate',
        difficulty: 'medium',
        cnName: '初级死活',
        count: 30
    },
    {
        dir: 'hard',
        difficulty: 'hard',
        cnName: '手筋进阶',
        count: 30
    }
];

function cleanDescription(cText) {
    if (!cText) return '黑先。请在 19路棋盘上找到局部的最妙下法。';
    // 去除推广网址与换行
    let cleaned = cText.replace(/https?:\/\/gogameguru\.com\/?/gi, '').trim();
    cleaned = cleaned.replace(/\s+/g, ' ');
    // 简单翻译核心前缀
    if (cleaned.startsWith('Black to play.')) {
        cleaned = cleaned.replace('Black to play.', '黑先。');
    }
    if (!cleaned.includes('黑先')) {
        cleaned = '黑先。' + cleaned;
    }
    return cleaned;
}

function build() {
    console.log('--- 开始扫描 SGF 并重建内置题库 ---');
    const allProblems = [];

    CONFIGS.forEach(cfg => {
        const categoryDir = path.join(GO_PROBLEMS_DIR, cfg.dir);
        if (!fs.existsSync(categoryDir)) {
            console.error(`错误: 目录不存在: ${categoryDir}`);
            return;
        }

        // 读取所有 .sgf 文件并过滤排序
        const files = fs.readdirSync(categoryDir)
            .filter(f => f.endsWith('.sgf'))
            .sort((a, b) => {
                // 按照数字序号排序，如 ggg-easy-02.sgf 与 ggg-easy-10.sgf
                const numA = parseInt(a.replace(/[^\d]/g, ''), 10) || 0;
                const numB = parseInt(b.replace(/[^\d]/g, ''), 10) || 0;
                return numA - numB;
            });

        console.log(`分类 [${cfg.dir}] 下找到 ${files.length} 个 SGF 文件，将提取前 ${cfg.count} 个...`);

        const limitFiles = files.slice(0, cfg.count);
        limitFiles.forEach((file, index) => {
            const filePath = path.join(categoryDir, file);
            const sgfContent = fs.readFileSync(filePath, 'utf-8').trim();

            // 解析获取 SGF 属性
            const rootNode = SgfParser.parse(sgfContent);
            let desc = '黑先。请在 19路棋盘上找到局部的最妙下法。';
            if (rootNode && rootNode.properties && rootNode.properties.C) {
                desc = cleanDescription(rootNode.properties.C);
            }

            const problemObj = {
                id: `${cfg.difficulty}_${index + 1}`,
                title: `${cfg.cnName}挑战 ${index + 1}`,
                difficulty: cfg.difficulty,
                desc: desc,
                sgf: sgfContent
            };

            allProblems.push(problemObj);
        });
    });

    console.log(`解析完成！总共处理了 ${allProblems.length} 道题目。`);

    // 生成 problems.js 内容
    const jsContent = `/**
 * 弈道 - 内置 19路死活题库 (Tsumego Library)
 * 本文件由 build_problems.js 脚本扫描 weekly-go-problems 自动生成。
 * 包含入门吃子、初级死活、手筋进阶各 30 道经典标准 19路 SGF 题目。
 */
const GO_PROBLEMS = ${JSON.stringify(allProblems, null, 4)};

if (typeof module !== 'undefined') {
    module.exports = GO_PROBLEMS;
}
`;

    fs.writeFileSync(OUTPUT_FILE, jsContent, 'utf-8');
    console.log(`成功写入新题库至: ${OUTPUT_FILE}`);
}

build();
