/**
 * 弈道 - SGF 棋谱解析器 (SGF Parser)
 * 能够将带有复杂嵌套分支的 SGF 文本解析为 JSON 树结构。
 */
class SgfParser {
    /**
     * 将 SGF 文本解析为树状 JavaScript 对象
     * @param {string} sgfText 原始 SGF 字符串
     * @returns {Object|null} 解析后的根节点，如果解析失败返回 null
     */
    static parse(sgfText) {
        let i = 0;
        const len = sgfText.length;

        function skipWhitespace() {
            while (i < len && sgfText[i] <= ' ') {
                i++;
            }
        }

        /**
         * 递归解析一个游戏树 (小括号包裹的部分)
         */
        function parseTree() {
            skipWhitespace();
            if (sgfText[i] !== '(') {
                return null;
            }
            i++; // 跳过 '('

            const sequence = [];

            while (i < len) {
                skipWhitespace();
                if (sgfText[i] === ';') {
                    i++; // 跳过 ';'
                    const node = parseNode();
                    if (node) {
                        sequence.push(node);
                    }
                } else if (sgfText[i] === '(') {
                    // 解析子分支
                    const subTree = parseTree();
                    if (subTree && sequence.length > 0) {
                        const parent = sequence[sequence.length - 1];
                        parent.children.push(subTree);
                    }
                } else if (sgfText[i] === ')') {
                    i++; // 跳过 ')'
                    break;
                } else {
                    // 忽略其它无效字符
                    i++;
                }
            }

            // 串联单线序列的父子关系
            for (let k = 0; k < sequence.length - 1; k++) {
                sequence[k].children.push(sequence[k + 1]);
            }

            // 返回该树序列的首节点
            return sequence[0] || null;
        }

        /**
         * 解析单个节点 (以分号开头直到下一个分号或括号的部分)
         */
        function parseNode() {
            const node = {
                properties: {},
                children: [] // 存放所有子分支节点
            };

            while (i < len) {
                skipWhitespace();
                // 遇到新节点或树的边界，当前节点结束
                if (sgfText[i] === ';' || sgfText[i] === '(' || sgfText[i] === ')') {
                    break;
                }

                // 1. 读取属性名称 (必须为大写字母，如 B, W, AB, AW, C, SZ 等)
                let propName = '';
                while (i < len && sgfText[i] >= 'A' && sgfText[i] <= 'Z') {
                    propName += sgfText[i];
                    i++;
                }

                if (!propName) {
                    i++;
                    continue;
                }

                // 2. 读取属性值 (放在一到多个方括号 [] 中，如 AB[pd][qd])
                const propValues = [];
                while (i < len) {
                    skipWhitespace();
                    if (sgfText[i] !== '[') {
                        break; // 属性值结束
                    }
                    i++; // 跳过 '['

                    let value = '';
                    while (i < len) {
                        if (sgfText[i] === '\\') {
                            // 处理转义字符，如 \] 或是 \\
                            value += sgfText[i + 1];
                            i += 2;
                        } else if (sgfText[i] === ']') {
                            i++; // 跳过 ']'
                            break;
                        } else {
                            value += sgfText[i];
                            i++;
                        }
                    }
                    propValues.push(value);
                }

                if (propValues.length > 0) {
                    // 如果只有一个属性值，则保存为字符串，否则保存为数组
                    node.properties[propName] = propValues.length === 1 ? propValues[0] : propValues;
                }
            }

            return node;
        }

        // 寻找最外层的 ( 作为起点
        skipWhitespace();
        while (i < len && sgfText[i] !== '(') {
            i++;
        }

        if (i >= len) {
            return null;
        }

        return parseTree();
    }

    /**
     * 将 SGF 字母坐标转换为棋盘的二维坐标
     * 例如 "pd" -> {x: 15, y: 3}
     * SGF 坐标系统中，a=0, b=1, ... s=18
     * 若为 "" 或 "tt" 则表示 Pass
     */
    static sgfToCoords(sgfCoord) {
        if (!sgfCoord || sgfCoord === 'tt' || sgfCoord === '') {
            return null; // Pass
        }
        const x = sgfCoord.charCodeAt(0) - 97;
        const y = sgfCoord.charCodeAt(1) - 97;
        return { x, y };
    }

    /**
     * 将棋盘的二维坐标转换为 SGF 字母坐标
     * 例如 {x: 15, y: 3} -> "pd"
     */
    static coordsToSgf(x, y) {
        if (x < 0 || y < 0) return 'tt';
        const cx = String.fromCharCode(97 + x);
        const cy = String.fromCharCode(97 + y);
        return cx + cy;
    }
}

// 导出模块
if (typeof module !== 'undefined') {
    module.exports = SgfParser;
}
