/**
 * 弈道 - 围棋基础规则与计算引擎 (Go Rules Engine)
 */
class GoRules {
    constructor(boardSize = 19) {
        this.boardSize = boardSize;
        // 初始化棋盘：null 表示无子，'black' 表示黑子，'white' 表示白子
        this.board = Array(boardSize).fill(null).map(() => Array(boardSize).fill(null));
        // 记录打劫禁着点坐标 {x, y}，若无则为 null
        this.koPoint = null;
    }

    /**
     * 重置棋盘
     */
    reset(boardSize = this.boardSize) {
        this.boardSize = boardSize;
        this.board = Array(boardSize).fill(null).map(() => Array(boardSize).fill(null));
        this.koPoint = null;
    }

    /**
     * 复制当前棋盘状态
     */
    cloneBoard() {
        return this.board.map(row => [...row]);
    }

    /**
     * 判断坐标是否在棋盘内
     */
    isOnBoard(x, y) {
        return x >= 0 && x < this.boardSize && y >= 0 && y < this.boardSize;
    }

    /**
     * 获取某一位置棋子的相邻坐标列表 (上下左右)
     */
    getNeighbors(x, y) {
        const neighbors = [];
        const directions = [[0, -1], [0, 1], [-1, 0], [1, 0]];
        for (const [dx, dy] of directions) {
            const nx = x + dx;
            const ny = y + dy;
            if (this.isOnBoard(nx, ny)) {
                neighbors.push({ x: nx, y: ny });
            }
        }
        return neighbors;
    }

    /**
     * 计算某一个棋子及其连接块的所有棋子(Stone Group)以及它们的气数(Liberties)
     * 使用广度优先搜索 (BFS)
     * @returns { stones: Array<{x,y}>, liberties: Array<{x,y}>, libertyCount: number }
     */
    getGroupInfo(startX, startY, boardState = this.board) {
        const color = boardState[startY][startX];
        if (!color) return { stones: [], liberties: [], libertyCount: 0 };

        const stones = [];
        const stonesSet = new Set();
        const libertiesSet = new Set();
        const queue = [{ x: startX, y: startY }];
        const visitedKey = (x, y) => `${x},${y}`;
        
        const visited = new Set();
        visited.add(visitedKey(startX, startY));

        while (queue.length > 0) {
            const curr = queue.shift();
            stones.push(curr);
            stonesSet.add(visitedKey(curr.x, curr.y));

            const neighbors = this.getNeighbors(curr.x, curr.y);
            for (const n of neighbors) {
                const nColor = boardState[n.y][n.x];
                const key = visitedKey(n.x, n.y);
                
                if (nColor === color) {
                    if (!visited.has(key)) {
                        visited.add(key);
                        queue.push(n);
                    }
                } else if (nColor === null) {
                    libertiesSet.add(key);
                }
            }
        }

        const liberties = Array.from(libertiesSet).map(key => {
            const [x, y] = key.split(',').map(Number);
            return { x, y };
        });

        return {
            stones,
            liberties,
            libertyCount: liberties.length
        };
    }

    /**
     * 校验落子合法性
     * @param {number} x X坐标
     * @param {number} y Y坐标
     * @param {string} color 落子颜色 'black' | 'white'
     * @returns {boolean} 是否为合法落子
     */
    isValidMove(x, y, color) {
        // 1. 检查是否在棋盘内且为空格
        if (!this.isOnBoard(x, y) || this.board[y][x] !== null) {
            return false;
        }

        // 2. 检查是否为劫点
        if (this.koPoint && this.koPoint.x === x && this.koPoint.y === y) {
            return false;
        }

        // 创建临时棋盘模拟落子
        const tempBoard = this.cloneBoard();
        tempBoard[y][x] = color;

        // 3. 检查落子是否能吃子 (如果能吃子，即使自己在这个落子后是0气，也是合法落子)
        const opponentColor = color === 'black' ? 'white' : 'black';
        const neighbors = this.getNeighbors(x, y);
        let wouldCapture = false;

        for (const n of neighbors) {
            if (tempBoard[n.y][n.x] === opponentColor) {
                const group = this.getGroupInfo(n.x, n.y, tempBoard);
                if (group.libertyCount === 0) {
                    wouldCapture = true;
                    break;
                }
            }
        }

        if (wouldCapture) {
            return true; // 能够吃子，合法
        }

        // 4. 检查是否是自杀禁着点（自己这一块棋在落子后是否有气）
        const myGroup = this.getGroupInfo(x, y, tempBoard);
        if (myGroup.libertyCount === 0) {
            return false; // 自杀，非法落子
        }

        return true;
    }

    /**
     * 执行落子并处理提子与劫争
     * @param {number} x X坐标
     * @param {number} y Y坐标
     * @param {string} color 落子颜色 'black' | 'white'
     * @returns {Array<{x,y}>|null} 提子坐标列表，若落子非法返回 null
     */
    playMove(x, y, color) {
        if (!this.isValidMove(x, y, color)) {
            return null;
        }

        // 1. 落子
        this.board[y][x] = color;

        // 2. 计算提子
        const opponentColor = color === 'black' ? 'white' : 'black';
        const neighbors = this.getNeighbors(x, y);
        const capturedStones = [];
        const checkedGroups = new Set();

        for (const n of neighbors) {
            if (this.board[n.y][n.x] === opponentColor) {
                // 生成代表该集团的特征Key防止重复提
                const groupInfo = this.getGroupInfo(n.x, n.y);
                const representativeKey = `${groupInfo.stones[0].x},${groupInfo.stones[0].y}`;
                
                if (!checkedGroups.has(representativeKey)) {
                    checkedGroups.add(representativeKey);
                    if (groupInfo.libertyCount === 0) {
                        // 该集团无气，提子
                        for (const stone of groupInfo.stones) {
                            this.board[stone.y][stone.x] = null;
                            capturedStones.push(stone);
                        }
                    }
                }
            }
        }

        // 3. 打劫(Ko)判定更新
        // 如果提子数量正好为 1，且落子者本身这一块棋也正好只有 1 气，这极可能是打劫的局部
        if (capturedStones.length === 1) {
            const myGroup = this.getGroupInfo(x, y);
            if (myGroup.libertyCount === 1) {
                // 标记被提掉的那颗子为下一次对方的打劫禁着点
                this.koPoint = capturedStones[0];
            } else {
                this.koPoint = null;
            }
        } else {
            this.koPoint = null;
        }

        return capturedStones;
    }
}
// 导出给前端其他脚本使用
if (typeof module !== 'undefined') {
    module.exports = GoRules;
}
