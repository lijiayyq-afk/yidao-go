const SgfParser = require('./sgfParser.js');
const GO_PROBLEMS = require('./problems.js');

console.log('--- 开始验证 GO_PROBLEMS 题库的合法性与解法树 ---');
console.log(`共加载到 ${GO_PROBLEMS.length} 道死活题。`);

// 仿真正解逻辑判定
function isSuccessComment(comment) {
    if (!comment) return false;
    return /correct|正解|成功|妙手/i.test(comment) && !/incorrect/i.test(comment);
}

function isFailureComment(comment) {
    if (!comment) return false;
    return /fail|wrong|incorrect|mistake|dead|die|escapes|better|ko|失败|错|不行|已死|棋差|坏棋|劫/i.test(comment);
}

function hasCorrectSolution(node) {
    const comment = node.properties.C || "";
    const gb = node.properties.GB;

    // 基础成功判定
    if (gb === "1" || gb === 1) return true;
    if (isSuccessComment(comment)) return true;
    if (isFailureComment(comment)) return false;

    // 叶子节点且非失败
    if (!node.children || node.children.length === 0) {
        return true; 
    }

    // 递归查找子节点
    for (const child of node.children) {
        if (hasCorrectSolution(child)) {
            return true;
        }
    }
    return false;
}

let errCount = 0;
GO_PROBLEMS.forEach((prob, index) => {
    try {
        const root = SgfParser.parse(prob.sgf);
        if (!root) {
            console.error(`[❌ 错误] 题目 ${prob.id} "${prob.title}": SGF 语法解析失败！`);
            errCount++;
            return;
        }

        // 验证初始子摆放
        const ab = root.properties.AB || [];
        const aw = root.properties.AW || [];
        const abArr = Array.isArray(ab) ? ab : [ab];
        const awArr = Array.isArray(aw) ? aw : [aw];

        // 校验坐标越界
        const checkCoords = (arr, name) => {
            arr.forEach(s => {
                const coord = SgfParser.sgfToCoords(s);
                if (coord) {
                    if (coord.x < 0 || coord.x >= 19 || coord.y < 0 || coord.y >= 19) {
                        console.error(`[❌ 错误] 题目 ${prob.id} "${prob.title}": 初始子 ${name}[${s}] 坐标越界！`);
                        errCount++;
                    }
                }
            });
        };

        checkCoords(abArr, 'AB');
        checkCoords(awArr, 'AW');

        // 验证是否有可行解
        const solveable = hasCorrectSolution(root);
        if (!solveable) {
            console.warn(`[⚠️ 警告] 题目 ${prob.id} "${prob.title}": 未能搜索到符合 Correct/正解 的分支叶子。请手动在前端测试确认其终局判定。`);
        }

    } catch (e) {
        console.error(`[❌ 异常] 题目 ${prob.id} "${prob.title}" 在处理时抛出异常:`, e);
        errCount++;
    }
});

console.log('-------------------------------------------');
if (errCount === 0) {
    console.log(`🎉 验证完毕！${GO_PROBLEMS.length} 道题目的 SGF 语法与初始坐标均 100% 正确！没有发现任何解析和坐标越界错误。`);
} else {
    console.error(`❌ 验证完毕。共发现 ${errCount} 处错误！请立刻排查。`);
}
process.exit(errCount === 0 ? 0 : 1);
