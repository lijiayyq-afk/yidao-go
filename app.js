/**
 * 弈道 - 应用核心控制器与界面集成 (Application Controller)
 */
class GoApp {
    constructor() {
        // 初始化规则引擎，默认为 19 路大棋盘
        this.rules = new GoRules(19);

        // 劫持 rules.reset 以便同步初始化 moveNumbers 数组
        const originalReset = this.rules.reset.bind(this.rules);
        this.rules.reset = (sz) => {
            originalReset(sz);
            this.initMoveNumbers(sz);
        };
        this.initMoveNumbers(19);

        this.currentMode = 'tsumego'; // tutorial | tsumego | import | sandbox
        
        // 棋盘绘制参数
        this.boardCanvas = document.getElementById('go-board');
        this.boardCtx = this.boardCanvas.getContext('2d');
        this.effectCanvas = document.getElementById('ink-effect-board');
        this.effectCtx = this.effectCanvas.getContext('2d');
        
        // 音效上下文
        this.audioCtx = null;
        
        // 当前关卡/题目状态
        this.currentLevelIndex = 0;
        this.currentProblem = null;
        this.sgfRootNode = null;
        this.sgfCurrentNode = null;
        
        // 沙盒模式参数
        this.sandboxColor = 'alternate'; // alternate | black | white
        this.nextSandboxColor = 'black';  // alternate 模式下的下一步颜色
        this.showLibertyNumbers = true;
        
        // 悔棋与历史栈
        // 栈中存放对象：{ board: Array, koPoint: Object, sgfNode: Object, turn: string, explanation: string }
        this.historyStack = [];
        
        // 水墨涟漪动画状态
        this.inkRipples = [];
        
        // 自动演示状态
        this.isPlayingSolution = false;
        this.solutionTimer = null;
        
        // 正解展示状态
        this.showSolutionLabels = false;

        // 当前玩家执子颜色 (默认黑先)
        this.playerColor = 'black';
        this.currentTurn = 'black';

        // 教学关卡定义
        this.initTutorialLevels();
        
        // 初始化做题进度与分页参数
        this.completedProblems = [];
        this.lastPlayedProblem = null;
        this.currentPage = 1;
        this.pageSize = 50;
        this.currentFilter = 'all';
        this.loadProgress();
        
        // 绑定事件与初始化
        this.computerMoveTimeout = null;
        this.isAnalysisMode = false;
        this.analysisSnapshot = null;
        this.initEvents();
        this.resizeBoard();
        this.switchMode('tsumego');
        this.animateInk();
    }

    /**
     * 初始化教学关卡数据
     */
    initTutorialLevels() {
        this.tutorialLevels = [
            {
                title: "第一关：气的概念",
                desc: "在围棋中，棋子在棋盘上直线紧邻的空白交叉点称为‘气’。点击棋盘上的任意位置放下一个黑子，观察它有几气（系统将以蓝色光圈高亮标示出气的位置）。",
                setup: (rules) => {
                    rules.reset(9);
                },
                onMove: (rules, move, app) => {
                    const group = rules.getGroupInfo(move.x, move.y);
                    app.highlightPoints = group.liberties; // 气点高亮
                    app.setExplanation(`您在 ${app.coordName(move.x, move.y)} 落下黑子。这颗子有 <strong>${group.libertyCount}</strong> 气（蓝色圆圈标示）。请尝试在蓝色位置落子，将它的气全部填满！`);
                    
                    // 记录下来，准备下一阶段
                    app.tutorialState = { targetStone: move, phase: 'fill' };
                },
                onSecondMove: (rules, move, app) => {
                    if (app.tutorialState && app.tutorialState.phase === 'fill') {
                        const target = app.tutorialState.targetStone;
                        const group = rules.getGroupInfo(target.x, target.y);
                        
                        // 排除已被占的子
                        app.highlightPoints = group.liberties;
                        
                        if (group.libertyCount === 0) {
                            app.highlightPoints = [];
                            app.showStatusModal(true, "吃子成功！", "气数归零，黑子被提掉。这展示了填满最后一气能够‘提起’对方棋子的核心原理！", () => {
                                app.nextTutorialLevel();
                            });
                        } else {
                            app.setExplanation(`已填一气，还剩 <strong>${group.libertyCount}</strong> 气。继续落子把它填满。`);
                        }
                    }
                }
            },
            {
                title: "第二关：吃子与提子",
                desc: "黑先。白棋的一颗子（D5）目前已经被黑棋包围了三面，仅剩最后一气（D6）。请点击 D6 交叉点，将其彻底提掉！",
                setup: (rules) => {
                    rules.reset(9);
                    rules.board[4][3] = 'white'; // D5 (x=3, y=4)
                    rules.board[3][3] = 'black'; // D6 (x=3, y=3)
                    rules.board[5][3] = 'black'; // D4 (x=3, y=5)
                    rules.board[4][2] = 'black'; // C5 (x=2, y=4)
                },
                onMove: (rules, move, app) => {
                    if (move.x === 4 && move.y === 4) { // E5 (x=4, y=4)
                        const caps = rules.playMove(4, 4, 'black');
                        if (caps && caps.length > 0) {
                            app.showStatusModal(true, "提子成功！", "漂亮！您落子在 E5 填满最后一气，将白棋 D5 提掉，棋子被移出棋盘并留下了提子痕迹。", () => {
                                app.nextTutorialLevel();
                            });
                        }
                    } else {
                        app.setExplanation("走法错误。白子仍然有气。注意白子目前唯一的逃跑路线是右侧的 E5 (坐标 5,5)。", "warning");
                    }
                }
            },
            {
                title: "第三关：自杀与禁着点",
                desc: "在围棋中，如果落子后自己的棋子气数为0，且不能提起对方的子，则该位置称为‘禁着点’，是不允许落子的（自杀禁手）。",
                setup: (rules) => {
                    rules.reset(9);
                    // 摆一个禁着点：四颗白子包围一个中心空位 E5 (x=4, y=4)
                    rules.board[3][4] = 'white'; // E6 (x=4, y=3)
                    rules.board[5][4] = 'white'; // E4 (x=4, y=5)
                    rules.board[4][3] = 'white'; // D5 (x=3, y=4)
                    rules.board[4][5] = 'white'; // F5 (x=5, y=4)
                },
                onMove: (rules, move, app) => {
                    // 玩家不管下哪里，都解释
                    if (move.x === 4 && move.y === 4) {
                        app.setExplanation("此处为禁着点！落子在此无气且无法吃子，属于禁着点，请在别处落子。", "warning");
                    } else {
                        app.setExplanation("请点击中心的 E5 格子。悬停时注意红圈警告，点击将被拦截，以此体验禁着点法则。");
                    }
                },
                onHover: (rules, x, y, app) => {
                    // 如果悬停在 E5 禁着点上
                    if (x === 4 && y === 4) {
                        app.hoverWarningPoint = { x, y };
                    } else {
                        app.hoverWarningPoint = null;
                    }
                },
                customCheck: (app) => {
                    // 点击别处可以跳过
                    app.showStatusModal(true, "理解禁着点", "您已成功体验了禁着点！如果旁边包围的白子可以被提掉，那么落子就是合法的。让我们进入下一关。", () => {
                        app.nextTutorialLevel();
                    });
                }
            },
            {
                title: "第四关：劫争与打劫",
                desc: "黑先。当前棋局处于‘打劫’的僵局中。黑1可以吃掉D5的白子，但白棋不能立刻回提。请点击 D5 提掉白棋，体验打劫的规则限制。",
                setup: (rules) => {
                    rules.reset(9);
                    // 摆打劫形状
                    rules.board[3][3] = 'black'; // D6
                    rules.board[4][2] = 'black'; // C5
                    rules.board[5][3] = 'black'; // D4
                    rules.board[4][4] = 'white'; // E5 - 叫吃黑D5
                    
                    rules.board[3][4] = 'white'; // E6
                    rules.board[5][4] = 'white'; // E4
                    rules.board[4][5] = 'white'; // F5
                    rules.board[4][3] = 'black'; // D5 - 叫吃白E5
                },
                onMove: (rules, move, app) => {
                    if (move.x === 4 && move.y === 4) { // 点击 E5 提掉白子
                        const caps = rules.playMove(4, 4, 'black');
                        if (caps && caps.length > 0) {
                            app.setExplanation("提子成功！此时由于打劫规则，白棋已被锁定，<strong>不能立刻回提 D5</strong>。白棋必须在别处落子（寻劫）。请点击下方按钮进入下一关。");
                            app.highlightPoints = [rules.koPoint]; // 标出劫争禁着点
                            
                            // 显示一个临时跳过按钮
                            setTimeout(() => {
                                app.showStatusModal(true, "打劫规避同形重复", "打劫规则防止了棋局陷入无休止的提子循环。这是围棋中最精彩的部分之一！", () => {
                                    app.nextTutorialLevel();
                                });
                            }, 2500);
                        }
                    } else {
                        app.setExplanation("白棋被叫吃的棋子在 E5 (坐标 5,5)。请落子在该处提起白子。", "warning");
                    }
                }
            },
            {
                title: "第五关：眼与死活判定",
                desc: "围棋的最终胜负由占地大小决定。一块棋要在包围中永久存活，必须拥有‘两个或两个以上相互独立的眼’。请在两个眼位（B2和B4）中落子，体验绝对防御。",
                setup: (rules) => {
                    rules.reset(9);
                    // 摆出黑棋两眼活棋的局面。眼在 B2 (1,1) 和 B4 (1,3)。
                    rules.board[0][0] = 'black'; // A1
                    rules.board[1][0] = 'black'; // A2
                    rules.board[2][0] = 'black'; // A3
                    rules.board[3][0] = 'black'; // A4
                    rules.board[4][0] = 'black'; // A5
                    
                    rules.board[0][1] = 'black'; // B1
                    // B2 (1,1) 是空格眼位
                    rules.board[2][1] = 'black'; // B3
                    // B4 (1,3) 是空格眼位
                    rules.board[4][1] = 'black'; // B5
                    
                    rules.board[0][2] = 'black'; // C1
                    rules.board[1][2] = 'black'; // C2
                    rules.board[2][2] = 'black'; // C3
                    rules.board[3][2] = 'black'; // C4
                    rules.board[4][2] = 'black'; // C5
                    
                    // 外部摆满白子，将其完全包围
                    rules.board[0][3] = 'white';
                    rules.board[1][3] = 'white';
                    rules.board[2][3] = 'white';
                    rules.board[3][3] = 'white';
                    rules.board[4][3] = 'white';
                    rules.board[5][0] = 'white';
                    rules.board[5][1] = 'white';
                    rules.board[5][2] = 'white';
                },
                onMove: (rules, move, app) => {
                    if ((move.x === 1 && move.y === 1) || (move.x === 1 && move.y === 3)) {
                        app.setExplanation("即使白棋下在这两处，也因为自杀禁手无法落子。即使能下一处，另一处依然有气，因此白棋绝对无法杀死这块黑子！这就是‘两眼活棋’的奥秘。");
                        setTimeout(() => {
                            app.showStatusModal(true, "恭喜通关！", "您已经掌握了围棋的气、吃子、禁着点、打劫和眼的核心规则！下面可以开始挑战真正的死活题了。", () => {
                                app.switchMode('tsumego');
                            });
                        }, 3000);
                    } else {
                        app.setExplanation("点击黑棋内部的两个空白格 B2 或 B4，理解为什么白棋永远无法将这两处全部填满。");
                    }
                }
            }
        ];
    }

    /**
     * 初始化事件监听
     */
    initEvents() {
        // 模式切换按钮
        const modes = ['tutorial', 'tsumego', 'import', 'sandbox'];
        modes.forEach(m => {
            const btn = document.getElementById(`btn-${m}`);
            if (btn) {
                btn.addEventListener('click', () => this.switchMode(m));
            }
        });

        // 棋盘点击落子
        this.boardCanvas.addEventListener('mousedown', (e) => this.handleBoardClick(e));
        this.boardCanvas.addEventListener('mousemove', (e) => this.handleBoardMouseMove(e));
        this.boardCanvas.addEventListener('mouseleave', () => {
            this.hoverWarningPoint = null;
            this.hoverPoint = null;
            this.drawBoard();
        });

        // 窗口 resize 自适应
        window.addEventListener('resize', () => {
            this.resizeBoard();
            this.drawBoard();
        });

        // 操作控制条
        document.getElementById('btn-reset').addEventListener('click', () => this.resetCurrentStage());
        document.getElementById('btn-undo').addEventListener('click', () => this.undoLastMove());
        document.getElementById('btn-show-solution').addEventListener('click', () => this.toggleSolutionLabels());
        document.getElementById('btn-auto-play').addEventListener('click', () => this.autoPlaySolution());
        document.getElementById('btn-analysis').addEventListener('click', () => this.toggleAnalysisMode());

        // 弹窗控制
        document.getElementById('modal-btn-close').addEventListener('click', () => {
            document.getElementById('status-modal').classList.remove('active');
            // 如果是在死活、导入或教学模式下做错了，点击重试自动重置题目
            if (this.currentMode === 'tsumego' || this.currentMode === 'import' || this.currentMode === 'tutorial') {
                this.resetCurrentStage();
            }
        });
        document.getElementById('modal-btn-next').addEventListener('click', () => {
            document.getElementById('status-modal').classList.remove('active');
            if (this.currentMode === 'tutorial') {
                this.nextTutorialLevel();
            } else if (this.currentMode === 'tsumego') {
                this.nextTsumegoProblem();
            }
        });

        // 棋谱导入
        document.getElementById('btn-load-sgf').addEventListener('click', () => this.loadCustomSgf());
        
        // 文件上传解析
        document.getElementById('sgf-file-input').addEventListener('change', (e) => this.handleSgfFileUpload(e));

        // 自由沙盒配置
        const sandboxRadios = document.getElementsByName('sandbox-color');
        sandboxRadios.forEach(radio => {
            radio.addEventListener('change', (e) => {
                this.sandboxColor = e.target.value;
                this.nextSandboxColor = 'black';
                this.updateTurnIndicator();
            });
        });

        document.getElementById('toggle-liberty-number').addEventListener('change', (e) => {
            this.showLibertyNumbers = e.target.checked;
            this.drawBoard();
        });

        // 难度分类 Tab 绑定
        const diffTabs = document.querySelectorAll('.diff-tab');
        diffTabs.forEach(tab => {
            tab.addEventListener('click', (e) => {
                diffTabs.forEach(t => t.classList.remove('active'));
                e.target.classList.add('active');
                this.currentPage = 1; // 切换难度，页码重置为 1
                
                // 渲染新难度的列表
                const activeDiff = e.target.dataset.diff;
                this.renderTsumegoList(activeDiff);

                // 自动载入该难度下第一题
                const list = this.getFilteredProblems(activeDiff);
                if (list.length > 0) {
                    this.loadTsumegoProblem(list[0]);
                }
            });
        });

        // 状态筛选过滤按钮绑定
        const filterBtns = document.querySelectorAll('.filter-btn');
        filterBtns.forEach(btn => {
            btn.addEventListener('click', (e) => {
                filterBtns.forEach(b => b.classList.remove('active'));
                e.target.classList.add('active');
                this.currentFilter = e.target.dataset.filter;
                this.currentPage = 1; // 切换筛选，页码重置为 1
                const activeDiff = this.getActiveDifficulty();
                this.renderTsumegoList(activeDiff);
            });
        });

        // 搜索跳转题号绑定
        const jumpBtn = document.getElementById('tsumego-jump-btn');
        const jumpInput = document.getElementById('tsumego-jump-input');
        if (jumpBtn && jumpInput) {
            const executeJump = () => {
                const val = parseInt(jumpInput.value, 10);
                if (isNaN(val) || val < 1) {
                    alert('请输入有效的正整数题号！');
                    return;
                }
                const activeDiff = this.getActiveDifficulty();
                const baseList = GO_PROBLEMS.filter(p => p.difficulty === activeDiff);
                if (val > baseList.length) {
                    alert(`当前难度下最多只有 ${baseList.length} 道题！`);
                    return;
                }
                const targetProb = baseList[val - 1];
                
                // 计算该题在当前过滤状态下的页码
                const displayList = this.getFilteredProblems(activeDiff);
                const dispIndex = displayList.findIndex(p => p.id === targetProb.id);
                if (dispIndex !== -1) {
                    this.currentPage = Math.floor(dispIndex / this.pageSize) + 1;
                } else {
                    // 如果由于当前的过滤，目标题目未被显示，则重设过滤为全部以查看它
                    this.currentFilter = 'all';
                    const allFilterBtns = document.querySelectorAll('.filter-btn');
                    allFilterBtns.forEach(b => {
                        if (b.dataset.filter === 'all') b.classList.add('active');
                        else b.classList.remove('active');
                    });
                    const refreshedList = this.getFilteredProblems(activeDiff);
                    const refIndex = refreshedList.findIndex(p => p.id === targetProb.id);
                    this.currentPage = Math.floor(refIndex / this.pageSize) + 1;
                }
                
                this.loadTsumegoProblem(targetProb);
                this.renderTsumegoList(activeDiff);
                jumpInput.value = '';
            };
            
            jumpBtn.addEventListener('click', executeJump);
            jumpInput.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') executeJump();
            });
        }

        // 绑定手机端快速选题抽屉展开与收起
        const toggleBtn = document.getElementById('btn-toggle-drawer');
        const drawer = document.getElementById('tsumego-drawer-content');
        if (toggleBtn && drawer) {
            toggleBtn.addEventListener('click', () => {
                const isCollapsed = drawer.classList.contains('collapsed');
                if (isCollapsed) {
                    drawer.classList.remove('collapsed');
                    toggleBtn.innerHTML = "收起选题 ▴";
                } else {
                    drawer.classList.add('collapsed');
                    toggleBtn.innerHTML = "快速选题 ▾";
                }
            });
        }
    }

    /**
     * 响应式调整棋盘尺寸
     */
    resizeBoard() {
        const wrapper = this.boardCanvas.parentElement;
        const size = wrapper.clientWidth - 24; // 扣除 padding
        
        // 设置真实像素大小（高清屏防模糊）
        const dpr = window.devicePixelRatio || 1;
        this.boardCanvas.width = size * dpr;
        this.boardCanvas.height = size * dpr;
        this.effectCanvas.width = size * dpr;
        this.effectCanvas.height = size * dpr;
        
        // 使用 CSS 缩放
        this.boardCanvas.style.width = `${size}px`;
        this.boardCanvas.style.height = `${size}px`;
        this.effectCanvas.style.width = `${size}px`;
        this.effectCanvas.style.height = `${size}px`;
        
        this.boardCtx.scale(dpr, dpr);
        this.effectCtx.scale(dpr, dpr);
        
        this.canvasSize = size;
    }

    /**
     * 切换主功能模式
     */
    switchMode(mode) {
        this.currentMode = mode;
        this.stopSolutionPlayback();
        this.clearComputerTimeout();
        this.resetAnalysisState();
        this.showSolutionLabels = false;
        
        // 更新导航状态
        document.querySelectorAll('.mode-btn').forEach(btn => {
            btn.classList.remove('active');
        });
        document.getElementById(`btn-${mode}`).classList.add('active');

        // 更新子面板状态
        document.querySelectorAll('.sub-panel').forEach(p => {
            p.classList.remove('active');
        });
        document.getElementById(`panel-${mode}`).classList.add('active');

        // 隐藏/显示自动演示与个人推演按钮
        const autoPlayBtn = document.getElementById('btn-auto-play');
        const analysisBtn = document.getElementById('btn-analysis');
        if (mode === 'tsumego' || mode === 'import') {
            autoPlayBtn.style.display = 'flex';
            if (analysisBtn) analysisBtn.style.display = 'flex';
        } else {
            autoPlayBtn.style.display = 'none';
            if (analysisBtn) analysisBtn.style.display = 'none';
        }

        // 清理高亮和悬停点
        this.highlightPoints = [];
        this.hoverWarningPoint = null;
        this.hoverPoint = null;
        this.historyStack = [];

        // 模式初始化逻辑
        if (mode === 'tutorial') {
            this.loadTutorialLevel(this.currentLevelIndex);
        } else if (mode === 'tsumego') {
            this.loadProgress();
            let targetProblem = GO_PROBLEMS[0];
            if (this.lastPlayedProblem) {
                const found = GO_PROBLEMS.find(p => p.id === this.lastPlayedProblem);
                if (found) targetProblem = found;
            }
            
            const diff = targetProblem.difficulty || 'easy';
            
            // 切换 Tab 高亮
            const tabs = document.querySelectorAll('.diff-tab');
            tabs.forEach(t => {
                if (t.dataset.diff === diff) t.classList.add('active');
                else t.classList.remove('active');
            });

            // 计算页码
            const filtered = this.getFilteredProblems(diff);
            const dispIndex = filtered.findIndex(p => p.id === targetProblem.id);
            if (dispIndex !== -1) {
                this.currentPage = Math.floor(dispIndex / this.pageSize) + 1;
            } else {
                this.currentPage = 1;
            }
            
            this.loadTsumegoProblem(targetProblem);
            this.renderTsumegoList(diff);
        } else if (mode === 'import') {
            this.rules.reset(19);
            this.currentTurn = 'black';
            this.setExplanation("请在上方粘贴您的 SGF 代码或上传 `.sgf` 文件，点击解析后即可开始挑战。");
            document.getElementById('info-badge').innerText = "棋谱解析";
            document.getElementById('parsed-info').style.display = 'none';
        } else if (mode === 'sandbox') {
            this.rules.reset(19);
            this.currentTurn = 'black';
            this.setExplanation("沙盒模式：自由落子。您可以开启‘气数显示’选项，直观地观察死活关系。");
            document.getElementById('info-badge').innerText = "沙盒测试";
        }

        this.updateTurnIndicator();
        this.drawBoard();
    }

    /**
     * 设置右侧水墨卡片评论文字
     */
    setExplanation(htmlContent, type = 'info') {
        const textEl = document.getElementById('explanation-text');
        textEl.innerHTML = htmlContent;
        
        const badgeEl = document.getElementById('info-badge');
        if (type === 'warning') {
            badgeEl.innerText = "规则警告";
            badgeEl.style.color = "var(--cinnabar)";
            badgeEl.style.borderColor = "var(--cinnabar)";
        } else {
            if (this.currentMode === 'tutorial') {
                badgeEl.innerText = `规则教学 (第 ${this.currentLevelIndex + 1} 关)`;
            } else if (this.currentMode === 'tsumego') {
                badgeEl.innerText = "死活手筋";
            } else if (this.currentMode === 'import') {
                badgeEl.innerText = "导入解析";
            } else {
                badgeEl.innerText = "对局沙盒";
            }
            badgeEl.style.color = "";
            badgeEl.style.borderColor = "";
        }
    }

    /**
     * 更新落子方指示器
     */
    updateTurnIndicator() {
        const turnText = document.getElementById('turn-text');
        const dot = document.querySelector('.turn-indicator .indicator-dot');
        
        dot.className = "indicator-dot " + (this.currentTurn === 'black' ? "black" : "white");
        turnText.innerText = this.currentTurn === 'black' ? "黑先" : "白先";
    }

    /**
     * 加载教学关卡
     */
    loadTutorialLevel(index) {
        this.currentLevelIndex = index;
        const level = this.tutorialLevels[index];
        level.setup(this.rules);
        this.currentTurn = 'black';
        this.highlightPoints = [];
        this.tutorialState = null;
        this.historyStack = [];
        
        // 更新左侧列表激活项
        this.renderTutorialList();
        this.setExplanation(level.desc);
        this.drawBoard();
    }

    /**
     * 渲染规则教学关卡列表
     */
    renderTutorialList() {
        const panel = document.getElementById('panel-tutorial');
        let listContainer = panel.querySelector('.level-list');
        listContainer.innerHTML = '';
        
        this.tutorialLevels.forEach((level, i) => {
            const btn = document.createElement('button');
            btn.className = `level-item ${i === this.currentLevelIndex ? 'active' : ''}`;
            btn.innerHTML = `<span>${level.title}</span>`;
            btn.addEventListener('click', () => this.loadTutorialLevel(i));
            listContainer.appendChild(btn);
        });
    }

    nextTutorialLevel() {
        if (this.currentLevelIndex < this.tutorialLevels.length - 1) {
            this.loadTutorialLevel(this.currentLevelIndex + 1);
        } else {
            this.showStatusModal(true, "全部通关！", "太棒了！您已学完了全部互动规则关卡。点击下方按钮即可前往‘死活题挑战’检验学习成果！", () => {
                this.switchMode('tsumego');
            });
        }
    }

    /**
     * 从 localStorage 加载进度
     */
    loadProgress() {
        const progressStr = localStorage.getItem('go_tsumego_progress');
        if (progressStr) {
            try {
                const data = JSON.parse(progressStr);
                this.completedProblems = data.completed || [];
                this.lastPlayedProblem = data.lastPlayed || null;
            } catch (e) {
                this.completedProblems = [];
                this.lastPlayedProblem = null;
            }
        }
    }

    /**
     * 保存进度到 localStorage
     */
    saveProgress() {
        const data = {
            completed: this.completedProblems,
            lastPlayed: this.lastPlayedProblem
        };
        localStorage.setItem('go_tsumego_progress', JSON.stringify(data));
    }

    /**
     * 获取当前处于激活状态的难度
     */
    getActiveDifficulty() {
        const tabs = document.querySelectorAll('.diff-tab');
        for (const tab of tabs) {
            if (tab.classList.contains('active')) {
                return tab.dataset.diff;
            }
        }
        return 'easy';
    }

    /**
     * 获取根据筛选器过滤后的题目列表
     */
    getFilteredProblems(difficulty) {
        const baseList = GO_PROBLEMS.filter(p => p.difficulty === difficulty);
        if (this.currentFilter === 'all') {
            return baseList;
        } else if (this.currentFilter === 'unstarted') {
            return baseList.filter(p => !this.completedProblems.includes(p.id));
        } else if (this.currentFilter === 'completed') {
            return baseList.filter(p => this.completedProblems.includes(p.id));
        }
        return baseList;
    }

    /**
     * 渲染平铺死活题列表与分页、进度展示
     */
    renderTsumegoList(difficulty) {
        const container = document.getElementById('problem-list-container');
        if (!container) return;
        container.innerHTML = '';

        // 1. 获取过滤后的题目列表
        const filtered = this.getFilteredProblems(difficulty);
        
        // 2. 渲染当前难度的总进度条
        const totalBase = GO_PROBLEMS.filter(p => p.difficulty === difficulty).length;
        const completedBase = GO_PROBLEMS.filter(p => p.difficulty === difficulty && this.completedProblems.includes(p.id)).length;
        const pct = totalBase > 0 ? ((completedBase / totalBase) * 100).toFixed(1) : '0.0';
        
        const progText = document.getElementById('tsumego-progress-text');
        const progBar = document.getElementById('tsumego-progress-bar');
        if (progText) progText.innerText = `${completedBase}/${totalBase} (${pct}%)`;
        if (progBar) progBar.style.width = `${pct}%`;

        // 3. 分页切片
        const start = (this.currentPage - 1) * this.pageSize;
        const end = Math.min(start + this.pageSize, filtered.length);
        const pageItems = filtered.slice(start, end);

        // 4. 渲染题目格子
        pageItems.forEach(prob => {
            const item = document.createElement('div');
            
            // 找出它在 base 列表中的绝对序号，比如 入门吃子 356
            const baseList = GO_PROBLEMS.filter(p => p.difficulty === difficulty);
            const indexInBase = baseList.findIndex(p => p.id === prob.id) + 1;

            item.className = 'problem-item';
            if (this.currentProblem && this.currentProblem.id === prob.id) {
                item.classList.add('active');
            }
            if (this.completedProblems.includes(prob.id)) {
                item.classList.add('completed');
            } else if (this.lastPlayedProblem === prob.id) {
                item.classList.add('in-progress');
            }

            item.innerText = indexInBase.toString();
            item.title = `${prob.title}`; // 悬停显示完整标题

            item.addEventListener('click', () => {
                this.loadTsumegoProblem(prob);
            });
            container.appendChild(item);
        });

        // 5. 渲染分页器
        this.renderPagination(filtered.length);
    }

    /**
     * 渲染分页按钮
     */
    renderPagination(totalItems) {
        const pagContainer = document.getElementById('tsumego-pagination');
        if (!pagContainer) return;
        pagContainer.innerHTML = '';

        const totalPages = Math.ceil(totalItems / this.pageSize);
        if (totalPages <= 1) return; // 只有一页时不显示分页器

        // 智能省略号分页，防止 40 页按钮撑爆容器
        const maxVisiblePages = 5;
        let startPage = Math.max(1, this.currentPage - 2);
        let endPage = Math.min(totalPages, startPage + maxVisiblePages - 1);

        if (endPage - startPage < maxVisiblePages - 1) {
            startPage = Math.max(1, endPage - maxVisiblePages + 1);
        }

        // 上一页
        if (this.currentPage > 1) {
            const prev = document.createElement('button');
            prev.className = 'page-btn';
            prev.innerText = '<';
            prev.addEventListener('click', () => {
                this.currentPage--;
                const activeDiff = this.getActiveDifficulty();
                this.renderTsumegoList(activeDiff);
            });
            pagContainer.appendChild(prev);
        }

        // 第一页与省略号
        if (startPage > 1) {
            const first = document.createElement('button');
            first.className = 'page-btn';
            first.innerText = '1';
            first.addEventListener('click', () => {
                this.currentPage = 1;
                const activeDiff = this.getActiveDifficulty();
                this.renderTsumegoList(activeDiff);
            });
            pagContainer.appendChild(first);

            if (startPage > 2) {
                const ell = document.createElement('span');
                ell.innerText = '...';
                ell.style.padding = '0 2px';
                pagContainer.appendChild(ell);
            }
        }

        // 页码按钮
        for (let p = startPage; p <= endPage; p++) {
            const btn = document.createElement('button');
            btn.className = `page-btn ${p === this.currentPage ? 'active' : ''}`;
            btn.innerText = p.toString();
            btn.addEventListener('click', () => {
                this.currentPage = p;
                const activeDiff = this.getActiveDifficulty();
                this.renderTsumegoList(activeDiff);
            });
            pagContainer.appendChild(btn);
        }

        // 最后一页与省略号
        if (endPage < totalPages) {
            if (endPage < totalPages - 1) {
                const ell = document.createElement('span');
                ell.innerText = '...';
                ell.style.padding = '0 2px';
                pagContainer.appendChild(ell);
            }

            const last = document.createElement('button');
            last.className = 'page-btn';
            last.innerText = totalPages.toString();
            last.addEventListener('click', () => {
                this.currentPage = totalPages;
                const activeDiff = this.getActiveDifficulty();
                this.renderTsumegoList(activeDiff);
            });
            pagContainer.appendChild(last);
        }

        // 下一页
        if (this.currentPage < totalPages) {
            const next = document.createElement('button');
            next.className = 'page-btn';
            next.innerText = '>';
            next.addEventListener('click', () => {
                this.currentPage++;
                const activeDiff = this.getActiveDifficulty();
                this.renderTsumegoList(activeDiff);
            });
            pagContainer.appendChild(next);
        }
    }

    /**
     * 加载一道死活题
     */
    loadTsumegoProblem(problem) {
        this.currentProblem = problem;
        this.stopSolutionPlayback();
        this.clearComputerTimeout();
        this.resetAnalysisState();
        this.showSolutionLabels = false;
        
        // 记录并保存上一次练习进度
        this.lastPlayedProblem = problem.id;
        this.saveProgress();

        // 解析 SGF
        const root = SgfParser.parse(problem.sgf);
        if (!root) {
            alert("棋谱解析错误！");
            return;
        }

        this.sgfRootNode = root;
        this.sgfCurrentNode = root;
        this.historyStack = [];

        // 初始化规则引擎棋盘大小
        const sz = parseInt(root.properties.SZ || 19);
        this.rules.reset(sz);

        // 还原初始子 AB (Add Black) 和 AW (Add White)
        this.setupInitialStones(root);

        // 获取首个落子节点以判定先手
        this.determineFirstPlayer(root);

        // 自动推断题目任务并深度汉化
        const taskName = this.inferProblemTask(root);

        // 设置提示评论
        const rawDesc = problem.desc || root.properties.C || "";
        const translatedDesc = rawDesc ? this.translateComment(rawDesc) : "如何应对？请在棋盘上落子。";
        this.setExplanation(`<strong>【${taskName}】</strong> ${translatedDesc}`);

        // 获取当前激活的难度
        const currentDiff = this.getActiveDifficulty();
        
        // 更新当前选中的中文标题展示看板
        const baseList = GO_PROBLEMS.filter(p => p.difficulty === currentDiff);
        const indexInBase = baseList.findIndex(p => p.id === problem.id) + 1;
        const titleEl = document.getElementById('current-problem-title');
        if (titleEl) {
            const diffName = problem.difficulty === 'easy' ? '入门吃子' : problem.difficulty === 'medium' ? '初级死活' : '手筋进阶';
            titleEl.innerText = `当前挑战：${diffName}挑战 ${indexInBase} ( ${taskName} )`;
        }

        // 刷新题目列表
        this.renderTsumegoList(currentDiff);

        this.updateTurnIndicator();
        this.drawBoard();

        // 在移动端选题后自动折叠抽屉以保证一屏显示
        if (window.innerWidth <= 768) {
            const drawer = document.getElementById('tsumego-drawer-content');
            const toggleBtn = document.getElementById('btn-toggle-drawer');
            if (drawer && toggleBtn) {
                drawer.classList.add('collapsed');
                toggleBtn.innerHTML = "快速选题 ▾";
            }
        }
    }

    /**
     * 根据 SGF 设置初始摆子
     */
    setupInitialStones(rootNode) {
        const ab = rootNode.properties.AB;
        const aw = rootNode.properties.AW;

        const addStones = (stones, color) => {
            if (!stones) return;
            if (Array.isArray(stones)) {
                stones.forEach(s => {
                    const coord = SgfParser.sgfToCoords(s);
                    if (coord) this.rules.board[coord.y][coord.x] = color;
                });
            } else {
                const coord = SgfParser.sgfToCoords(stones);
                if (coord) this.rules.board[coord.y][coord.x] = color;
            }
        };

        addStones(ab, 'black');
        addStones(aw, 'white');
    }

    /**
     * 判定先手
     */
    determineFirstPlayer(rootNode) {
        // 先检查是否有 PL (Player) 标记
        if (rootNode.properties.PL) {
            this.playerColor = rootNode.properties.PL === 'B' ? 'black' : 'white';
            this.currentTurn = this.playerColor;
            return;
        }

        // 寻找第一个含有 B 或 W 属性的后代节点
        let nextNode = rootNode.children[0];
        while (nextNode) {
            if (nextNode.properties.B) {
                this.playerColor = 'black';
                this.currentTurn = 'black';
                break;
            } else if (nextNode.properties.W) {
                this.playerColor = 'white';
                this.currentTurn = 'white';
                break;
            }
            nextNode = nextNode.children[0];
        }
        
        // 默认黑先
        if (!this.playerColor) {
            this.playerColor = 'black';
            this.currentTurn = 'black';
        }
    }

    /**
     * 智能推断死活题类型：做活、净杀、吃子、双活等
     */
    inferProblemTask(rootNode) {
        if (!rootNode) return "黑先";
        
        const comment = (rootNode.properties.C || "").toLowerCase();
        
        const hasLive = /live|alive|活|眼|make eye/i.test(comment);
        const hasKill = /kill|capture|dead|die|escapes|杀|死|吃|提/i.test(comment);
        const hasKo = /ko|劫/i.test(comment);
        const hasSeki = /seki|双活/i.test(comment);

        if (hasKo) {
            if (hasKill) return "黑先劫杀";
            return "黑先劫活";
        }
        if (hasSeki) {
            return "黑先双活";
        }
        if (hasKill) {
            if (/capture|吃|捕/i.test(comment)) return "黑先吃子";
            return "黑先净杀";
        }
        if (hasLive) {
            return "黑先做活";
        }

        // 兜底推断
        if (this.currentProblem) {
            if (this.currentProblem.difficulty === 'easy') {
                return "黑先吃子";
            }
            if (comment.includes("杀") || comment.includes("破")) return "黑先净杀";
            if (comment.includes("活")) return "黑先做活";
        }

        return "黑先做活";
    }

    nextTsumegoProblem() {
        const index = GO_PROBLEMS.findIndex(p => p.id === this.currentProblem.id);
        if (index < GO_PROBLEMS.length - 1) {
            const nextProb = GO_PROBLEMS[index + 1];
            
            // 自动计算下一道题在当前过滤状态下的页码
            const activeDiff = nextProb.difficulty || 'easy';
            const displayList = this.getFilteredProblems(activeDiff);
            const dispIndex = displayList.findIndex(p => p.id === nextProb.id);
            if (dispIndex !== -1) {
                this.currentPage = Math.floor(dispIndex / this.pageSize) + 1;
            } else {
                // 如果由于过滤导致看不到下一题，自动把过滤置回'all'
                this.currentFilter = 'all';
                const allFilterBtns = document.querySelectorAll('.filter-btn');
                allFilterBtns.forEach(b => {
                    if (b.dataset.filter === 'all') b.classList.add('active');
                    else b.classList.remove('active');
                });
                const refreshedList = this.getFilteredProblems(activeDiff);
                const refIndex = refreshedList.findIndex(p => p.id === nextProb.id);
                this.currentPage = Math.floor(refIndex / this.pageSize) + 1;
            }
            
            // 切换 Tab 高亮
            const tabs = document.querySelectorAll('.diff-tab');
            tabs.forEach(t => {
                if (t.dataset.diff === activeDiff) t.classList.add('active');
                else t.classList.remove('active');
            });

            this.loadTsumegoProblem(nextProb);
            this.renderTsumegoList(activeDiff);
        } else {
            this.showStatusModal(true, "炉火纯青！", "恭喜您！您已经完成了内置的所有死活题关卡！您可以继续尝试在‘棋谱导入’中粘贴外部的 SGF 棋谱进行练习。", () => {
                this.switchMode('import');
            });
        }
    }

    /**
     * 自定义 SGF 导入载入
     */
    loadCustomSgf() {
        const text = document.getElementById('sgf-textarea').value.trim();
        if (!text) {
            alert("请输入 SGF 格式的文本！");
            return;
        }

        const root = SgfParser.parse(text);
        if (!root) {
            alert("SGF 解析失败，请检查语法格式！例如括号是否匹配，节点分号是否缺失。");
            return;
        }

        this.sgfRootNode = root;
        this.sgfCurrentNode = root;
        this.currentProblem = null;
        this.historyStack = [];

        // 棋盘大小
        const sz = parseInt(root.properties.SZ || 19);
        this.rules.reset(sz);
        this.setupInitialStones(root);
        this.determineFirstPlayer(root);

        // 界面显示
        const desc = root.properties.C ? this.translateComment(root.properties.C) : "外部棋谱载入成功，黑先。请开始挑战。";
        this.setExplanation(desc);

        // 展示棋谱信息
        document.getElementById('parsed-info').style.display = 'block';
        document.getElementById('info-size').innerText = `${sz} x ${sz}`;
        document.getElementById('info-player').innerText = this.playerColor === 'black' ? '黑棋' : '白棋';

        this.updateTurnIndicator();
        this.drawBoard();
    }

    /**
     * 解析上传的 SGF 文件
     */
    handleSgfFileUpload(e) {
        const file = e.target.files[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = (evt) => {
            document.getElementById('sgf-textarea').value = evt.target.result;
            this.loadCustomSgf();
        };
        reader.readAsText(file, "UTF-8");
    }

    /**
     * 悔棋 (Undo)
     */
    undoLastMove() {
        this.stopSolutionPlayback();
        this.clearComputerTimeout();
        if (this.historyStack.length === 0) {
            this.setExplanation("已退回初始局面。", "warning");
            return;
        }

        // 弹出上一次状态
        const snap = this.historyStack.pop();
        
        // 恢复棋盘
        this.rules.board = snap.board;
        this.rules.koPoint = snap.koPoint;
        this.currentTurn = snap.turn;
        this.setExplanation(snap.explanation);

        if (snap.moveNumbers !== undefined) {
            this.moveNumbers = snap.moveNumbers;
            this.currentStepCount = snap.stepCount;
        }

        if (this.currentMode === 'tsumego' || this.currentMode === 'import') {
            this.sgfCurrentNode = snap.sgfNode;
        }

        this.highlightPoints = [];
        this.updateTurnIndicator();
        this.drawBoard();
    }

    /**
     * 保存状态至历史栈（用于悔棋）
     */
    saveHistory(explanationText = "") {
        const boardSnap = this.rules.cloneBoard();
        const koSnap = this.rules.koPoint ? { ...this.rules.koPoint } : null;
        const currentExp = explanationText || document.getElementById('explanation-text').innerHTML;
        
        const moveNumbersSnap = this.moveNumbers ? this.moveNumbers.map(row => [...row]) : null;

        this.historyStack.push({
            board: boardSnap,
            koPoint: koSnap,
            sgfNode: this.sgfCurrentNode,
            turn: this.currentTurn,
            explanation: currentExp,
            moveNumbers: moveNumbersSnap,
            stepCount: this.currentStepCount
        });
    }

    /**
     * 重新开始当前关卡
     */
    resetCurrentStage() {
        this.stopSolutionPlayback();
        this.clearComputerTimeout();
        if (this.currentMode === 'tutorial') {
            this.loadTutorialLevel(this.currentLevelIndex);
        } else if (this.currentMode === 'tsumego') {
            this.loadTsumegoProblem(this.currentProblem);
        } else if (this.currentMode === 'import') {
            if (this.sgfRootNode) {
                this.sgfCurrentNode = this.sgfRootNode;
                this.rules.reset(parseInt(this.sgfRootNode.properties.SZ || 19));
                this.setupInitialStones(this.sgfRootNode);
                this.determineFirstPlayer(this.sgfRootNode);
                this.setExplanation(this.sgfRootNode.properties.C || "已重新开始。");
                this.historyStack = [];
                this.drawBoard();
            }
        } else if (this.currentMode === 'sandbox') {
            this.rules.reset(this.rules.boardSize);
            this.currentTurn = 'black';
            this.nextSandboxColor = 'black';
            this.historyStack = [];
            this.setExplanation("沙盒已重置。");
            this.drawBoard();
        }
    }

    /**
     * 开启/关闭显示正解标记
     */
    toggleSolutionLabels() {
        this.showSolutionLabels = !this.showSolutionLabels;
        this.drawBoard();
        
        if (this.showSolutionLabels) {
            // 实时查找整条正解路径文字描述
            const solutionPath = [];
            const findCorrectPath = (node) => {
                solutionPath.push(node);
                if (!node.children || node.children.length === 0) {
                    let pathHasCorrect = false;
                    for (const n of solutionPath) {
                        const comment = (n.properties.C || "").trim();
                        const gb = n.properties.GB;
                        if (gb === "1" || gb === 1) pathHasCorrect = true;
                        if (/correct|正解|成功|妙手/i.test(comment) && !/incorrect/i.test(comment)) {
                            pathHasCorrect = true;
                        }
                    }
                    const lastComment = (node.properties.C || "").trim();
                    const hasFailure = /fail|wrong|incorrect|mistake|dead|die|escapes|better|ko|失败|错|不行|已死|棋差|坏棋|劫/i.test(lastComment);
                    return pathHasCorrect && !hasFailure;
                }
                for (const child of node.children) {
                    if (findCorrectPath(child)) return true;
                    solutionPath.pop();
                }
                return false;
            };

            const found = findCorrectPath(this.sgfRootNode);
            if (found && solutionPath.length > 1) {
                let stepsText = "";
                for (let idx = 1; idx < solutionPath.length; idx++) {
                    const node = solutionPath[idx];
                    const isBlack = node.properties.B !== undefined;
                    const moveVal = isBlack ? node.properties.B : node.properties.W;
                    const coord = SgfParser.sgfToCoords(moveVal);
                    if (coord) {
                        stepsText += `<strong>${isBlack ? '黑' : '白'}${idx}</strong>[${this.coordName(coord.x, coord.y)}] `;
                    }
                }
                this.setExplanation(`<strong>【正解解析】</strong>：${stepsText}<br/><span style="color:var(--cinnabar); font-size:13px;">提示：棋盘上绿圈数字为落子次序，点击“自动演示”可观看动态走法。</span>`);
            } else {
                this.setExplanation("已开启解析提示。当前题目无明确的唯一正解链。");
            }
        } else {
            // 恢复当前题目说明
            this.loadTsumegoProblem(this.currentProblem);
        }
    }

    /**
     * 处理棋盘鼠标悬停
     */
    handleBoardMouseMove(e) {
        if (this.isPlayingSolution) return;
        
        const rect = this.boardCanvas.getBoundingClientRect();
        const mouseX = e.clientX - rect.left;
        const mouseY = e.clientY - rect.top;
        
        // 棋盘格点间距
        const size = this.canvasSize;
        const pad = size * 0.05; // 边距
        const gridWidth = size - 2 * pad;
        const step = gridWidth / (this.rules.boardSize - 1);
        
        // 寻找最近的交叉点
        const x = Math.round((mouseX - pad) / step);
        const y = Math.round((mouseY - pad) / step);
        
        if (x >= 0 && x < this.rules.boardSize && y >= 0 && y < this.rules.boardSize) {
            // 如果悬停交叉点有变化才重绘
            if (!this.hoverPoint || this.hoverPoint.x !== x || this.hoverPoint.y !== y) {
                this.hoverPoint = { x, y };
                
                // 触发教学关卡 Hover 判定
                if (this.currentMode === 'tutorial' && this.tutorialLevels[this.currentLevelIndex].onHover) {
                    this.tutorialLevels[this.currentLevelIndex].onHover(this.rules, x, y, this);
                }
                
                this.drawBoard();
            }
        } else {
            if (this.hoverPoint) {
                this.hoverPoint = null;
                this.hoverWarningPoint = null;
                this.drawBoard();
            }
        }
    }

    /**
     * 核心：处理棋盘落子点击
     */
    handleBoardClick(e) {
        if (this.isPlayingSolution) return;
        
        // 激活 AudioContext (解决浏览器对 Audio 自动播放的限制)
        if (!this.audioCtx) {
            this.audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        }

        const rect = this.boardCanvas.getBoundingClientRect();
        const mouseX = e.clientX - rect.left;
        const mouseY = e.clientY - rect.top;
        
        const size = this.canvasSize;
        const pad = size * 0.05;
        const gridWidth = size - 2 * pad;
        const step = gridWidth / (this.rules.boardSize - 1);
        
        const x = Math.round((mouseX - pad) / step);
        const y = Math.round((mouseY - pad) / step);
        
        if (!this.rules.isOnBoard(x, y)) return;
        if (this.rules.board[y][x] !== null) return;

        // 1. 教学模式下的点击判定
        if (this.currentMode === 'tutorial') {
            const level = this.tutorialLevels[this.currentLevelIndex];
            
            // 劫争/吃子等需要执行落子动作的关卡
            if (this.currentLevelIndex === 1 || this.currentLevelIndex === 3) {
                // 执行逻辑
                this.saveHistory();
                const caps = this.rules.playMove(x, y, this.currentTurn);
                if (caps !== null) {
                    this.playStoneSound();
                    this.triggerInkRipple(x, y);
                    level.onMove(this.rules, { x, y }, this);
                } else {
                    this.setExplanation("落子无效（可能是自杀或禁着点）。", "warning");
                }
            } else if (this.currentLevelIndex === 2) {
                // 禁着点体验关卡
                level.onMove(this.rules, { x, y }, this);
                if (x !== 4 || y !== 4) {
                    // 点击别处算作确认，跳过
                    level.customCheck(this);
                }
            } else {
                // 普通落子测试 (第一关气，第五关眼位)
                this.saveHistory();
                this.rules.board[y][x] = this.currentTurn;
                this.playStoneSound();
                this.triggerInkRipple(x, y);
                
                if (this.tutorialState) {
                    level.onSecondMove(this.rules, { x, y }, this);
                } else {
                    level.onMove(this.rules, { x, y }, this);
                }
            }
            this.drawBoard();
            return;
        }

        // 2. 沙盒模式落子
        if (this.currentMode === 'sandbox') {
            this.saveHistory();
            let colorToPlay = this.currentTurn;
            if (this.sandboxColor !== 'alternate') {
                colorToPlay = this.sandboxColor;
            }

            const caps = this.rules.playMove(x, y, colorToPlay);
            if (caps !== null) {
                this.playStoneSound();
                this.triggerInkRipple(x, y);
                this.onSuccessfulMove(x, y, caps);
                
                // 切换交替回合
                if (this.sandboxColor === 'alternate') {
                    this.currentTurn = this.currentTurn === 'black' ? 'white' : 'black';
                }
                this.setExplanation(`落子成功。${caps.length > 0 ? `提起对方共 <strong>${caps.length}</strong> 子。` : ''}`);
                this.updateTurnIndicator();
                this.drawBoard();
            } else {
                this.setExplanation("禁着点，无法落子！", "warning");
                // 剔除历史
                this.historyStack.pop();
            }
            return;
        }

        // 3. 死活题 / 导入棋谱模式
        if (this.currentMode === 'tsumego' || this.currentMode === 'import') {
            if (this.isAnalysisMode) {
                // 如果是个人推演模式，走自由落子推演逻辑 (类似于沙盒，黑白交替)
                this.saveHistory();
                const caps = this.rules.playMove(x, y, this.currentTurn);
                if (caps !== null) {
                    this.playStoneSound();
                    this.triggerInkRipple(x, y);
                    this.onSuccessfulMove(x, y, caps);
                    
                    // 切换交替回合
                    this.currentTurn = this.currentTurn === 'black' ? 'white' : 'black';
                    this.setExplanation(`<strong>【个人推演中】</strong> 成功落子于 ${this.coordName(x, y)}。${caps.length > 0 ? `提起对方共 <strong>${caps.length}</strong> 子。` : ''}`);
                    this.updateTurnIndicator();
                    this.drawBoard();
                } else {
                    this.setExplanation("禁着点，无法落子！", "warning");
                    this.historyStack.pop();
                }
                return;
            }

            if (!this.sgfCurrentNode) return;
            
            const targetSgf = SgfParser.coordsToSgf(x, y);
            const playerChar = this.currentTurn === 'black' ? 'B' : 'W';
            
            // 匹配子分支
            let matchedChild = null;
            for (const child of this.sgfCurrentNode.children) {
                const moveVal = child.properties[playerChar];
                if (moveVal === targetSgf) {
                    matchedChild = child;
                    break;
                }
            }

            if (matchedChild) {
                // 正确在 SGF 分支中，玩家落子
                this.saveHistory();
                const caps = this.rules.playMove(x, y, this.currentTurn);
                this.onSuccessfulMove(x, y, caps);
                this.playStoneSound();
                this.triggerInkRipple(x, y);
                this.sgfCurrentNode = matchedChild;

                const userComment = matchedChild.properties.C ? this.translateComment(matchedChild.properties.C) : "";
                this.setExplanation(userComment || "下子正确，请等待电脑应手...");

                // 检查电脑是否有应手
                if (matchedChild.children && matchedChild.children.length > 0) {
                    const compTurn = this.currentTurn === 'black' ? 'white' : 'black';
                    const compChar = compTurn === 'black' ? 'B' : 'W';
                    
                    // 电脑选择对应的分叉下子
                    const compNode = matchedChild.children[0];
                    const compSgfMove = compNode.properties[compChar];
                    
                    if (compSgfMove) {
                        const compCoord = SgfParser.sgfToCoords(compSgfMove);
                        
                        // 稍微延迟 600ms 显得电脑在思考
                        this.isPlayingSolution = true; // 期间锁死棋盘
                        
                        this.computerMoveTimeout = setTimeout(() => {
                            this.computerMoveTimeout = null;
                            this.isPlayingSolution = false;
                            if (compCoord) {
                                const compCaps = this.rules.playMove(compCoord.x, compCoord.y, compTurn);
                                this.onSuccessfulMove(compCoord.x, compCoord.y, compCaps);
                                this.playStoneSound();
                                this.triggerInkRipple(compCoord.x, compCoord.y);
                                this.sgfCurrentNode = compNode;
                                
                                const compComment = compNode.properties.C ? this.translateComment(compNode.properties.C) : "";
                                this.setExplanation(compComment || `电脑应以 ${this.coordName(compCoord.x, compCoord.y)}。`);
                                
                                // 检查白棋应手后是否为叶子节点以判定输赢
                                this.checkGameEndState(compNode);
                            }
                            this.drawBoard();
                        }, 600);
                    }
                } else {
                    // 玩家落子后已是叶子节点，判定是否成功
                    this.checkGameEndState(matchedChild);
                }
            } else {
                // 不在分支上，视为错着
                this.setExplanation("此落子不属于题目变化图中的最佳手筋。请尝试其它位置！", "warning");
                
                // 触发朱砂红水墨波纹与棋盘颤抖动效
                this.triggerInkRipple(x, y, true);
                const boardWood = this.boardCanvas.parentElement;
                if (boardWood) {
                    boardWood.classList.add('shake-error');
                    setTimeout(() => boardWood.classList.remove('shake-error'), 400);
                }

                // 闪烁红色警示
                this.hoverWarningPoint = { x, y };
                setTimeout(() => {
                    this.hoverWarningPoint = null;
                    this.drawBoard();
                }, 400);
            }
            this.drawBoard();
        }
    }

    /**
     * 深度优先遍历 SGF 树，检查其中是否含有任何成功标志
     */
    hasAnySuccessMarker(node) {
        if (!node) return false;
        const comment = node.properties.C || "";
        const gb = node.properties.GB;
        if (gb === "1" || gb === 1) return true;
        if (/correct|正解|成功|妙手/i.test(comment) && !/incorrect/i.test(comment)) {
            return true;
        }
        if (node.children) {
            for (const child of node.children) {
                if (this.hasAnySuccessMarker(child)) return true;
            }
        }
        return false;
    }

    /**
     * 判定当前行棋路径是否是一条正解路径
     */
    isCurrentPathCorrect() {
        if (!this.sgfCurrentNode) return false;

        const pathNodes = [];
        this.historyStack.forEach(snap => {
            if (snap.sgfNode) pathNodes.push(snap.sgfNode);
        });
        pathNodes.push(this.sgfCurrentNode);

        // 1. 检查整条路径上是否有任何节点包含失败词
        for (const node of pathNodes) {
            const comment = (node.properties.C || "").trim();
            if (/fail|wrong|incorrect|mistake|dead|die|escapes|better|ko|失败|错|不行|已死|棋差|坏棋|劫/i.test(comment)) {
                return false;
            }
        }

        // 2. 检查整棵 SGF 树是否带有成功标志
        const treeHasSuccess = this.hasAnySuccessMarker(this.sgfRootNode);

        if (treeHasSuccess) {
            // 如果树中有成功标志，要求整条路径中必须含有成功标记
            let hasSuccess = false;
            for (const node of pathNodes) {
                const comment = (node.properties.C || "").trim();
                const gb = node.properties.GB;
                if (gb === "1" || gb === 1) {
                    hasSuccess = true;
                    break;
                }
                if (/correct|正解|成功|妙手/i.test(comment) && !/incorrect/i.test(comment)) {
                    hasSuccess = true;
                    break;
                }
            }
            return hasSuccess;
        } else {
            // 如果树中没有成功标志，说明是单线正解题，只要走到叶子节点就是对的
            const isLeaf = !this.sgfCurrentNode.children || this.sgfCurrentNode.children.length === 0;
            return isLeaf;
        }
    }

    /**
     * 检测棋局终局输赢状态 (基于 SGF 叶子评论与全路径正解判定)
     */
    checkGameEndState(node) {
        const rawComment = node.properties.C || "";
        const comment = this.translateComment(rawComment);
        
        // 只有在没有子节点（叶子节点）时才进行终局判定
        const isLeaf = !node.children || node.children.length === 0;
        if (isLeaf) {
            const pathIsCorrect = this.isCurrentPathCorrect();

            if (pathIsCorrect) {
                // 标记该题目为已完成并保存
                if (this.currentProblem && !this.completedProblems.includes(this.currentProblem.id)) {
                    this.completedProblems.push(this.currentProblem.id);
                    this.saveProgress();
                    
                    // 重新渲染题目列表以更新已完成状态绿勾和难度进度条
                    const activeDiff = this.getActiveDifficulty();
                    this.renderTsumegoList(activeDiff);
                }
                setTimeout(() => {
                    this.showStatusModal(true, "挑战成功！", comment || "恭喜您，解出了最佳活路手筋！");
                }, 800);
            } else {
                setTimeout(() => {
                    this.showStatusModal(false, "挑战失败", comment || "黑棋行棋不当，已被对方杀死，或未达到净活/净杀效果。请撤回或重新开始。");
                }, 800);
            }
        }
    }

    /**
     * 弹窗渲染
     */
    showStatusModal(isSuccess, title, message, nextCallback = null) {
        const modal = document.getElementById('status-modal');
        const titleEl = document.getElementById('modal-title');
        const msgEl = document.getElementById('modal-message');
        const nextBtn = document.getElementById('modal-btn-next');
        const iconEl = document.getElementById('modal-status-icon');

        titleEl.innerText = title;
        msgEl.innerText = message;
        
        if (isSuccess) {
            iconEl.innerText = "☯";
            iconEl.style.color = "var(--cinnabar)";
            nextBtn.style.display = "block";
            nextBtn.innerText = this.currentMode === 'tutorial' ? "进入下一关" : "下一道题";
        } else {
            iconEl.innerText = "✖";
            iconEl.style.color = "var(--ink-light)";
            nextBtn.style.display = "none";
        }

        modal.classList.add('active');
    }

    /**
     * 自动播放正解演示
     */
    autoPlaySolution() {
        if (this.currentMode !== 'tsumego' && this.currentMode !== 'import') return;
        if (!this.sgfRootNode) return;

        this.stopSolutionPlayback();
        this.resetCurrentStage();

        this.isPlayingSolution = true;
        
        // 寻找正解路径
        const path = [];
        const findCorrectPath = (node) => {
            path.push(node);
            if (!node.children || node.children.length === 0) {
                // 检查当前演示路径中是否包含任何一个正解标志节点
                let pathHasCorrect = false;
                for (const n of path) {
                    const comment = (n.properties.C || "").trim();
                    const gb = n.properties.GB;
                    if (gb === "1" || gb === 1) pathHasCorrect = true;
                    if (/correct|正解|成功|妙手/i.test(comment) && !/incorrect/i.test(comment)) {
                        pathHasCorrect = true;
                    }
                }
                const lastComment = (node.properties.C || "").trim();
                const hasFailure = /fail|wrong|incorrect|mistake|dead|die|escapes|better|ko|失败|错|不行|已死|棋差|坏棋|劫/i.test(lastComment);
                return pathHasCorrect && !hasFailure;
            }
            
            for (const child of node.children) {
                if (findCorrectPath(child)) {
                    return true;
                }
                path.pop(); // 回溯
            }
            return false;
        };

        const success = findCorrectPath(this.sgfRootNode);
        if (!success || path.length <= 1) {
            this.setExplanation("未能找到明确的正解变化图分支，无法自动演示。", "warning");
            this.isPlayingSolution = false;
            return;
        }

        // 定时器顺序落子
        let stepIndex = 1; // 0 是 root 节点
        this.setExplanation("正在演示正确的手筋步骤，请仔细揣摩...");

        this.solutionTimer = setInterval(() => {
            if (stepIndex >= path.length) {
                this.stopSolutionPlayback();
                this.setExplanation("演示完毕。您可以点击‘重新开始’自行体验解法。");
                return;
            }

            const curr = path[stepIndex];
            // 找出是黑棋还是白棋落子
            const isBlack = curr.properties.B !== undefined;
            const moveVal = isBlack ? curr.properties.B : curr.properties.W;
            const coord = SgfParser.sgfToCoords(moveVal);

            if (coord) {
                const caps = this.rules.playMove(coord.x, coord.y, isBlack ? 'black' : 'white');
                this.onSuccessfulMove(coord.x, coord.y, caps);
                this.playStoneSound();
                this.triggerInkRipple(coord.x, coord.y);
                this.drawBoard();
            }

            stepIndex++;
        }, 1200);
    }

    stopSolutionPlayback() {
        this.isPlayingSolution = false;
        if (this.solutionTimer) {
            clearInterval(this.solutionTimer);
            this.solutionTimer = null;
        }
    }

    clearComputerTimeout() {
        if (this.computerMoveTimeout) {
            clearTimeout(this.computerMoveTimeout);
            this.computerMoveTimeout = null;
        }
        this.isPlayingSolution = false;
    }

    resetAnalysisState() {
        this.isAnalysisMode = false;
        this.analysisSnapshot = null;
        const btn = document.getElementById('btn-analysis');
        if (btn) {
            btn.innerHTML = `<span class="icon">☯</span> 个人推演`;
            btn.classList.remove('active');
            btn.style.color = '';
            btn.style.borderColor = '';
        }
    }

    toggleAnalysisMode() {
        if (this.currentMode !== 'tsumego' && this.currentMode !== 'import') return;
        
        this.stopSolutionPlayback();
        this.clearComputerTimeout();

        const btn = document.getElementById('btn-analysis');
        if (!btn) return;

        if (!this.isAnalysisMode) {
            // 进入推演模式
            this.isAnalysisMode = true;
            
            // 备份当前状态以供退出时还原
            this.analysisSnapshot = {
                board: this.rules.cloneBoard(),
                koPoint: this.rules.koPoint ? { ...this.rules.koPoint } : null,
                sgfNode: this.sgfCurrentNode,
                turn: this.currentTurn,
                moveNumbers: this.moveNumbers ? this.moveNumbers.map(row => [...row]) : null,
                stepCount: this.currentStepCount,
                explanation: document.getElementById('explanation-text').innerHTML
            };

            // UI 状态改变
            btn.innerHTML = `<span class="icon">✕</span> 退出推演`;
            btn.classList.add('active');
            btn.style.color = 'var(--cinnabar)';
            btn.style.borderColor = 'var(--cinnabar)';

            this.setExplanation("<strong>【个人推演中】</strong> 您已进入自由推演研究模式。电脑已暂停应子，您可以黑白交替任意落子推敲变化。点击“退出推演”可还原盘面继续做题。");
        } else {
            // 退出推演模式，还原状态
            this.isAnalysisMode = false;
            
            if (this.analysisSnapshot) {
                this.rules.board = this.analysisSnapshot.board;
                this.rules.koPoint = this.analysisSnapshot.koPoint;
                this.sgfCurrentNode = this.analysisSnapshot.sgfNode;
                this.currentTurn = this.analysisSnapshot.turn;
                this.moveNumbers = this.analysisSnapshot.moveNumbers;
                this.currentStepCount = this.analysisSnapshot.stepCount;
                this.setExplanation(this.analysisSnapshot.explanation);
                this.analysisSnapshot = null;
            }

            btn.innerHTML = `<span class="icon">☯</span> 个人推演`;
            btn.classList.remove('active');
            btn.style.color = '';
            btn.style.borderColor = '';
        }
        
        this.updateTurnIndicator();
        this.drawBoard();
    }

    /**
     * 坐标转化为人类可读名称 (如 D5, E6)
     */
    initMoveNumbers(sz) {
        this.currentStepCount = 0;
        this.moveNumbers = Array(sz).fill(null).map(() => Array(sz).fill(0));
    }

    onSuccessfulMove(x, y, caps) {
        this.currentStepCount++;
        if (this.moveNumbers && this.moveNumbers[y]) {
            this.moveNumbers[y][x] = this.currentStepCount;
        }
        if (caps && caps.length > 0) {
            caps.forEach(c => {
                if (this.moveNumbers && this.moveNumbers[c.y]) {
                    this.moveNumbers[c.y][c.x] = 0;
                }
            });
        }
    }

    /**
     * 智能中英文汉化转换
     */
    translateComment(text) {
        if (!text) return "";
        let t = text.trim();
        // 过滤网页推广
        t = t.replace(/https?:\/\/gogameguru\.com\/?/gi, "");

        const mapping = [
            { pattern: /Also correct\. Playing A at B is better style though/i, replacement: "也是正解。不过下在 B 位棋形更好，可以留有更少余味。" },
            { pattern: /Also correct\. Playing this move at A is usually better style because it leaves less bad aji \(potential for bad things to happen\) on the outside\./i, replacement: "也是正解。通常下在 A 位棋形更好，因为这可以减少外围的恶劣余味（潜在缺陷）。" },
            { pattern: /Also correct\. Playing this move at A is usually better style/i, replacement: "也是正解。通常下在 A 位棋形更好，可以留有更少余味。" },
            { pattern: /Correct, if Black ignores A, White can play at B/i, replacement: "正确！如果黑棋脱先，白棋可以在 B 位发难。" },
            { pattern: /Correct, Black could also play A at B to live with one more point/i, replacement: "正确！黑棋也可以将 A 改下在 B 位，多得一目。" },
            { pattern: /Correct\. Black has enough liberties to play here in this case\./i, replacement: "正解！黑棋在此局面下有足够的气落子。" },
            { pattern: /Correct\. Now, even if White captures the four stones, it won't be possible to make two eyes\./i, replacement: "正解！现在即使白棋提掉这四颗子，也无法做出两眼。" },
            { pattern: /Correct\. Now both groups are alive in seki\./i, replacement: "正解！现在双方在双活中存活。" },
            { pattern: /Correct\. Now Black's alive in seki\. If White tries to play A or B, Black can capture and make two eyes\./i, replacement: "正解！黑棋已在双活中存活。如果白棋尝试下在 A 或 B，黑棋可以提子并做出两眼。" },
            { pattern: /Correct\. Black wins the capturing race\./i, replacement: "正解！黑棋赢得了对杀。" },
            { pattern: /Correct\. Black captures the cutting stones\./i, replacement: "正解！黑棋吃掉了对方的切断子。" },
            { pattern: /Correct\. It's a ko\./i, replacement: "正解！形成劫争。" },
            { pattern: /Correct/i, replacement: "正解！" },
            { pattern: /Also correct/i, replacement: "这也是正解之一。" },
            { pattern: /It's a ko, but Black should exchange/i, replacement: "这是劫争，但黑棋应当先做交换..." },
            { pattern: /It's a ko, but Black can do better/i, replacement: "这是劫争，但黑棋还可以做得更好（有净活或净杀解法）。" },
            { pattern: /Now it's a ko, but Black can do better/i, replacement: "这会形成打劫，但黑棋还可以做得更好（有净活或净杀手段）。" },
            { pattern: /There's a ko at A, but Black can do better/i, replacement: "在 A 位有劫争，但黑棋还可以做得更好（有净活或净杀解法）。" },
            { pattern: /It's a ko/i, replacement: "形成劫争。" },
            { pattern: /ko/i, replacement: "形成劫争。" },
            { pattern: /Black to play/i, replacement: "黑先。" },
            { pattern: /White's already alive in a seki/i, replacement: "白棋已在双活中存活。" },
            { pattern: /White's already alive/i, replacement: "白棋已做活，黑棋失败。" },
            { pattern: /White lives/i, replacement: "白棋做活，失败。" },
            { pattern: /White escapes/i, replacement: "白棋逃跑，失败。" },
            { pattern: /Black is dead/i, replacement: "黑棋已死，失败。" },
            { pattern: /Black dies/i, replacement: "黑棋被杀，失败。" },
            { pattern: /Black can't do better/i, replacement: "黑棋没有更好的下法了。" },
            { pattern: /Black can do better/i, replacement: "黑棋还可以做得更好，请尝试其他下法。" },
            { pattern: /This is also possible, but there was a better move for A\./i, replacement: "这样下也是一种选择，但 A 位有更好的手筋。" },
            { pattern: /This is possible, but Black can do better\./i, replacement: "可行，但黑棋还可以做得更好。" },
            { pattern: /Bad style/i, replacement: "行棋俗手/坏棋型，不推荐。" },
            { pattern: /White's stone can easily escape/i, replacement: "白子可以轻易逃出。" },
            { pattern: /Lots of bad aji/i, replacement: "留下许多恶劣余味（坏味道）。" },
            { pattern: /White loses his corner/i, replacement: "白棋失去角部。" },
            { pattern: /White got tricked\.\.\./i, replacement: "白棋应对失误..." },
            { pattern: /Black shouldn't live, but does with this move/i, replacement: "黑棋本无法活棋，但此手让黑棋起死回生。" },
            { pattern: /This is a mistake for White\.\.\./i, replacement: "此步是白棋的失误..." },
            { pattern: /This is a mistake for White\. A should be at B/i, replacement: "白棋应对失误。A 应改下在 B。" },
            { pattern: /This is a crucial move for White/i, replacement: "这是白棋的关键一手。" },
            { pattern: /It's bent four in the corner/i, replacement: "这属于角部板六（常作死棋处理，请参考板六规则）。" },
            { pattern: /White can't play here\.\.\./i, replacement: "白棋不能下在这里..." },
            { pattern: /White can't play here either\.\.\./i, replacement: "白棋也不能下在这里..." },
            { pattern: /White can't get more liberties\.\.\./i, replacement: "白棋无法获得更多的气..." },
            { pattern: /White just gives away two points\.\.\./i, replacement: "白棋只是白送了两目..." },
            { pattern: /Seki/i, replacement: "双活。" },
            { pattern: /Black's already alive in a seki/i, replacement: "黑棋已双活。" },
            { pattern: /Can you find a way to capture White's two stones\?/i, replacement: "您能设法吃掉白棋两子吗？" },
            { pattern: /White's alive\. Even if Black connects at A next, White's already alive in seki\./i, replacement: "白棋已活。即使黑棋下一步粘在 A 位，白棋也已在双活中存活。" },
            { pattern: /Correct\. Even if White connects at A next, she'll lose the capturing race because it's 'one eye vs no eye'\./i, replacement: "正解！即使白棋下一步粘在 A 位，也会因为‘有眼杀无眼’而在对杀中失败。" },
            { pattern: /Even if Black connects at A next, White's already alive in seki\./i, replacement: "即使黑棋下一步粘在 A 位，白棋也已在双活中存活。" },
            { pattern: /Good move, this makes White's eyespace as small as possible\./i, replacement: "妙手！这能最大限度地缩小白棋的眼位空间。" },
            { pattern: /Correct\. If White plays A, Black can just play B \(or atari at C in some situations\)\. White can't make two eyes\./i, replacement: "正解！如果白棋下在 A，黑棋只需应对以 B（某些情况下可以在 C 叫吃）。白棋无法做出两眼。" },
            { pattern: /Black almost had it\. There's a better move than A\./i, replacement: "黑棋功败垂成，有比 A 更好的急所。" },
            { pattern: /White's four in a row eyespace is alive because White A and B are miai/i, replacement: "白棋的直四（或弯四）眼位是活棋，因为 A 和 B 互为见合。" },
            { pattern: /Black doesn't have enough liberties to make a ko, so Black dies\./i, replacement: "黑棋气数不足以形成劫争，黑子被杀。" },
            { pattern: /Now Black has to fight a ko, but Black can do better\./i, replacement: "如此黑棋必须打劫，但黑棋还可以做得更好。" },
            { pattern: /Black can't make two eyes now\. A is a false eye/i, replacement: "黑棋无法做出两眼。A 处是假眼。" },
            { pattern: /White plays on the vital point/i, replacement: "白棋点在要点（急所）上。" },
            { pattern: /It's already a dead shape/i, replacement: "这已经是死形（死棋）。" },
            { pattern: /A and B are miai for Black/i, replacement: "A 和 B 互为见合，黑棋活棋。" },
            { pattern: /Correct\. This is the best shape, because it gives Black the best potential for making eyes/i, replacement: "正解！这是最佳棋形，为黑棋后续做眼留下了最大的空间。" },
            { pattern: /How can you stop this happening\?/i, replacement: "您能设法阻止这一切发生吗？" },
            { pattern: /It's a snapback/i, replacement: "这是倒扑！" },
            { pattern: /There's a better move for this/i, replacement: "这步棋有更好的手筋。" }
        ];

        for (const item of mapping) {
            if (item.pattern.test(t)) {
                t = t.replace(item.pattern, item.replacement);
            }
        }

        // 单词/短语兜底汉化，以防未匹配上面的长句
        const wordMapping = [
            { w: /\bBlack to play\b/gi, r: "黑先" },
            { w: /\bWhite to play\b/gi, r: "白先" },
            { w: /\bBlack to live\b/gi, r: "黑棋做活" },
            { w: /\bBlack to kill White\b/gi, r: "黑先杀白" },
            { w: /\bcorrect\b/gi, r: "正解" },
            { w: /\bincorrect\b/gi, r: "错误" },
            { w: /\bfailed\b/gi, r: "失败" },
            { w: /\bfail\b/gi, r: "失败" },
            { w: /\bmistake\b/gi, r: "失误" },
            { w: /\btenukis?\b/gi, r: "脱先" },
            { w: /\bsente\b/gi, r: "先手" },
            { w: /\bgote\b/gi, r: "后手" },
            { w: /\batari\b/gi, r: "叫吃" },
            { w: /\bcapture\b/gi, r: "提子" },
            { w: /\bseki\b/gi, r: "双活" },
            { w: /\bko\b/gi, r: "劫争" },
            { w: /\bliberty\b/gi, r: "气" },
            { w: /\bliberties\b/gi, r: "气" },
            { w: /\beyespace\b/gi, r: "眼位空间" },
            { w: /\beye\b/gi, r: "眼" },
            { w: /\bfalse eye\b/gi, r: "假眼" },
            { w: /\bvital point\b/gi, r: "要点（急所）" },
            { w: /\bmiai\b/gi, r: "见合" },
            { w: /\bladder\b/gi, r: "征子" },
            { w: /\bsnapback\b/gi, r: "倒扑" }
        ];

        for (const item of wordMapping) {
            t = t.replace(item.w, item.r);
        }

        return t.trim();
    }

    coordName(x, y) {
        // 围棋坐标横坐标没有 I 字母，但这里我们使用简单的 A-T
        const chars = "ABCDEFGHJKLMNOPQRST"; // 排除 I
        const col = chars[x] || "?";
        const row = this.rules.boardSize - y;
        return `${col}${row}`;
    }

    /* ==========================================================================
       音效合成逻辑 (Web Audio API)
       ========================================================================== */
    playStoneSound() {
        if (!this.audioCtx) return;
        const now = this.audioCtx.currentTime;
        
        // 核心1：清脆的木质敲击瞬间 (Clack)
        const osc1 = this.audioCtx.createOscillator();
        const gain1 = this.audioCtx.createGain();
        osc1.type = 'triangle';
        osc1.frequency.setValueAtTime(650, now);
        osc1.frequency.exponentialRampToValueAtTime(140, now + 0.08); // 快速下滑音
        
        gain1.gain.setValueAtTime(0.7, now);
        gain1.gain.exponentialRampToValueAtTime(0.005, now + 0.08);
        
        // 核心2：木制棋盘共振共鸣音 (Resonance)
        const osc2 = this.audioCtx.createOscillator();
        const gain2 = this.audioCtx.createGain();
        const filter = this.audioCtx.createBiquadFilter();
        
        osc2.type = 'sine';
        osc2.frequency.setValueAtTime(190, now);
        osc2.frequency.exponentialRampToValueAtTime(80, now + 0.28);
        
        filter.type = 'bandpass';
        filter.frequency.setValueAtTime(220, now);
        filter.Q.setValueAtTime(2.5, now);
        
        gain2.gain.setValueAtTime(0.4, now);
        gain2.gain.exponentialRampToValueAtTime(0.001, now + 0.28);
        
        // 节点串接
        osc1.connect(gain1);
        gain1.connect(this.audioCtx.destination);
        
        osc2.connect(filter);
        filter.connect(gain2);
        gain2.connect(this.audioCtx.destination);
        
        // 发声并垃圾回收
        osc1.start(now);
        osc1.stop(now + 0.08);
        
        osc2.start(now);
        osc2.stop(now + 0.28);
    }

    /* ==========================================================================
       Canvas 绘图与水墨动效系统
       ========================================================================== */
    drawBoard() {
        const ctx = this.boardCtx;
        const size = this.canvasSize;
        ctx.clearRect(0, 0, size, size);

        const boardSize = this.rules.boardSize;
        const pad = size * 0.05; // 边距
        const gridWidth = size - 2 * pad;
        const step = gridWidth / (boardSize - 1);

        // 1. 绘制网格线
        ctx.lineWidth = 1;
        ctx.strokeStyle = "rgba(74, 49, 24, 0.7)"; // 褐色线

        for (let i = 0; i < boardSize; i++) {
            // 横线
            ctx.beginPath();
            ctx.moveTo(pad, pad + i * step);
            ctx.lineTo(pad + gridWidth, pad + i * step);
            ctx.stroke();

            // 竖线
            ctx.beginPath();
            ctx.moveTo(pad + i * step, pad);
            ctx.lineTo(pad + i * step, pad + gridWidth);
            ctx.stroke();
        }

        // 2. 绘制星位 (Star points)
        ctx.fillStyle = "rgba(74, 49, 24, 0.9)";
        const drawStar = (gx, gy) => {
            ctx.beginPath();
            ctx.arc(pad + gx * step, pad + gy * step, size * 0.007, 0, 2 * Math.PI);
            ctx.fill();
        };

        if (boardSize === 19) {
            const starCoords = [3, 9, 15];
            for (const x of starCoords) {
                for (const y of starCoords) {
                    drawStar(x, y);
                }
            }
        } else if (boardSize === 9) {
            drawStar(2, 2);
            drawStar(6, 2);
            drawStar(2, 6);
            drawStar(6, 6);
            drawStar(4, 4); // 天元
        }

        // 3. 绘制棋盘边线序号 (坐标标识)
        ctx.fillStyle = "rgba(74, 49, 24, 0.8)";
        ctx.font = `${Math.max(10, size * 0.024)}px var(--font-sans)`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        const labelChars = "ABCDEFGHJKLMNOPQRST";

        for (let i = 0; i < boardSize; i++) {
            // 列字符 (横轴)
            ctx.fillText(labelChars[i], pad + i * step, pad * 0.4);
            ctx.fillText(labelChars[i], pad + i * step, size - pad * 0.4);
            
            // 行数字 (纵轴)
            ctx.fillText((boardSize - i).toString(), pad * 0.4, pad + i * step);
            ctx.fillText((boardSize - i).toString(), size - pad * 0.4, pad + i * step);
        }

        // 4. 绘制棋子
        const rad = step * 0.47; // 棋子半径略微小于格子的一半
        for (let y = 0; y < boardSize; y++) {
            for (let x = 0; x < boardSize; x++) {
                const color = this.rules.board[y][x];
                if (color) {
                    const cx = pad + x * step;
                    const cy = pad + y * step;
                    this.drawStone(ctx, cx, cy, rad, color, x, y);
                }
            }
        }

        // 5. 绘制气数高亮 (教学/沙盒模式的辅助标识)
        if (this.highlightPoints && this.highlightPoints.length > 0) {
            this.highlightPoints.forEach(p => {
                const cx = pad + p.x * step;
                const cy = pad + p.y * step;
                ctx.beginPath();
                ctx.arc(cx, cy, rad * 0.4, 0, 2 * Math.PI);
                ctx.fillStyle = "rgba(59, 130, 246, 0.4)";
                ctx.fill();
                ctx.lineWidth = 1.5;
                ctx.strokeStyle = "rgba(59, 130, 246, 0.8)";
                ctx.stroke();
            });
        }

        // 6. 绘制候选正解提示标记 (带序号的绿圈，展示完整正解链)
        if (this.showSolutionLabels && this.sgfRootNode) {
            const solutionPath = [];
            const findCorrectPath = (node) => {
                solutionPath.push(node);
                if (!node.children || node.children.length === 0) {
                    let pathHasCorrect = false;
                    for (const n of solutionPath) {
                        const comment = (n.properties.C || "").trim();
                        const gb = n.properties.GB;
                        if (gb === "1" || gb === 1) pathHasCorrect = true;
                        if (/correct|正解|成功|妙手/i.test(comment) && !/incorrect/i.test(comment)) {
                            pathHasCorrect = true;
                        }
                    }
                    const lastComment = (node.properties.C || "").trim();
                    const hasFailure = /fail|wrong|incorrect|mistake|dead|die|escapes|better|ko|失败|错|不行|已死|棋差|坏棋|劫/i.test(lastComment);
                    return pathHasCorrect && !hasFailure;
                }
                for (const child of node.children) {
                    if (findCorrectPath(child)) return true;
                    solutionPath.pop();
                }
                return false;
            };

            const found = findCorrectPath(this.sgfRootNode);
            if (found && solutionPath.length > 1) {
                for (let idx = 1; idx < solutionPath.length; idx++) {
                    const node = solutionPath[idx];
                    const isBlack = node.properties.B !== undefined;
                    const moveVal = isBlack ? node.properties.B : node.properties.W;
                    const coord = SgfParser.sgfToCoords(moveVal);
                    if (coord) {
                        const cx = pad + coord.x * step;
                        const cy = pad + coord.y * step;
                        
                        ctx.beginPath();
                        ctx.arc(cx, cy, rad * 0.65, 0, 2 * Math.PI);
                        ctx.fillStyle = "rgba(255, 255, 255, 0.85)";
                        ctx.fill();
                        ctx.lineWidth = 2;
                        ctx.strokeStyle = "rgba(16, 185, 129, 0.9)";
                        ctx.stroke();
                        
                        ctx.font = `bold ${rad * 0.85}px var(--font-sans)`;
                        ctx.fillStyle = "rgba(16, 185, 129, 0.95)";
                        ctx.textAlign = "center";
                        ctx.textBaseline = "middle";
                        ctx.fillText(idx.toString(), cx, cy);
                    }
                }
            }
        }

        // 7. 绘制落子警告（自杀警告）
        if (this.hoverWarningPoint) {
            const cx = pad + this.hoverWarningPoint.x * step;
            const cy = pad + this.hoverWarningPoint.y * step;
            ctx.beginPath();
            ctx.arc(cx, cy, rad * 0.7, 0, 2 * Math.PI);
            ctx.strokeStyle = "rgba(220, 38, 38, 0.85)";
            ctx.lineWidth = 3;
            ctx.stroke();
            
            // 十字警告叉
            ctx.beginPath();
            ctx.moveTo(cx - rad * 0.3, cy - rad * 0.3);
            ctx.lineTo(cx + rad * 0.3, cy + rad * 0.3);
            ctx.moveTo(cx + rad * 0.3, cy - rad * 0.3);
            ctx.lineTo(cx - rad * 0.3, cy + rad * 0.3);
            ctx.stroke();
        }

        // 8. 绘制半透明悬停预览子
        if (this.hoverPoint && this.rules.board[this.hoverPoint.y][this.hoverPoint.x] === null && !this.isPlayingSolution) {
            // 确保不悬停在自杀点上
            if (!this.hoverWarningPoint) {
                const cx = pad + this.hoverPoint.x * step;
                const cy = pad + this.hoverPoint.y * step;
                ctx.save();
                ctx.globalAlpha = 0.5;
                let colorToDraw = this.currentTurn;
                if (this.currentMode === 'sandbox' && this.sandboxColor !== 'alternate') {
                    colorToDraw = this.sandboxColor;
                }
                this.drawStone(ctx, cx, cy, rad, colorToDraw, this.hoverPoint.x, this.hoverPoint.y, true);
                ctx.restore();
            }
        }
    }

    /**
     * 绘制 3D 拟真质感棋子与气数
     */
    drawStone(ctx, cx, cy, rad, color, gridX, gridY, isPreview = false) {
        ctx.save();
        
        // 1. 投影绘制 (让棋子浮起来，如果是预览子则淡化阴影)
        if (!isPreview) {
            ctx.shadowColor = "rgba(0, 0, 0, 0.35)";
            ctx.shadowBlur = 4;
            ctx.shadowOffsetX = rad * 0.12;
            ctx.shadowOffsetY = rad * 0.12;
        }

        // 2. 径向渐变，实现玉石云子立体感
        const grad = ctx.createRadialGradient(
            cx - rad * 0.15, cy - rad * 0.15, rad * 0.05, 
            cx, cy, rad
        );

        if (color === 'black') {
            // 墨黑色 (松烟墨，泛着微微灰绿的温润色泽)
            grad.addColorStop(0, '#555e65');
            grad.addColorStop(0.3, '#2a2f35');
            grad.addColorStop(1, '#111416');
            ctx.fillStyle = grad;
        } else {
            // 温白玉色 (乳白带微黄)
            grad.addColorStop(0, '#ffffff');
            grad.addColorStop(0.6, '#f4f3ed');
            grad.addColorStop(1, '#dcdbd3');
            ctx.fillStyle = grad;
            
            // 白棋增加细小的深色内边框线提高轮廓分明度
            ctx.strokeStyle = "rgba(0, 0, 0, 0.12)";
            ctx.lineWidth = 0.5;
        }

        ctx.beginPath();
        ctx.arc(cx, cy, rad, 0, 2 * Math.PI);
        ctx.fill();
        if (color === 'white') {
            ctx.stroke();
        }
        
        ctx.restore();

        // 3. 动态绘制棋子上的气数值 (仅在沙盒且勾选展示时)
        let hasLibertyDrawn = false;
        if (this.currentMode === 'sandbox' && this.showLibertyNumbers && !isPreview) {
            const group = this.rules.getGroupInfo(gridX, gridY);
            ctx.font = `bold ${rad * 0.9}px var(--font-sans)`;
            ctx.fillStyle = color === 'black' ? 'rgba(255,255,255,0.85)' : 'rgba(0,0,0,0.7)';
            ctx.textAlign = "center";
            ctx.textBaseline = "middle";
            ctx.fillText(group.libertyCount.toString(), cx, cy);
            hasLibertyDrawn = true;
        }

        // 4. 动态绘制落子顺序数字 (在非教学模式下，且位置有落子序号，且未绘制气数)
        if (this.currentMode !== 'tutorial' && !isPreview && !hasLibertyDrawn && this.moveNumbers && this.moveNumbers[gridY] && this.moveNumbers[gridY][gridX] > 0) {
            const stepNum = this.moveNumbers[gridY][gridX];
            ctx.font = `bold ${rad * 0.85}px var(--font-sans)`;
            ctx.fillStyle = color === 'black' ? 'rgba(255,255,255,0.85)' : 'rgba(0,0,0,0.7)';
            ctx.textAlign = "center";
            ctx.textBaseline = "middle";
            ctx.fillText(stepNum.toString(), cx, cy);
        }
    }

    /**
     * 触发落子水墨波纹
     */
    triggerInkRipple(gridX, gridY, isWarning = false) {
        const step = (this.canvasSize - 2 * (this.canvasSize * 0.05)) / (this.rules.boardSize - 1);
        const pad = this.canvasSize * 0.05;
        
        const cx = pad + gridX * step;
        const cy = pad + gridY * step;
        
        this.inkRipples.push({
            cx,
            cy,
            radius: step * 0.1,
            maxRadius: step * 1.6,
            alpha: 0.6,
            speed: step * 0.08,
            color: isWarning ? '184, 59, 48' : '26, 30, 33'
        });
    }

    /**
     * 循环渲染水墨晕染层 (Canvas 2)
     */
    animateInk() {
        const ctx = this.effectCtx;
        const size = this.canvasSize;
        ctx.clearRect(0, 0, size, size);

        for (let k = this.inkRipples.length - 1; k >= 0; k--) {
            const rip = this.inkRipples[k];
            const colorStr = rip.color || '26, 30, 33';
            
            // 绘制晕染圈
            ctx.beginPath();
            ctx.arc(rip.cx, rip.cy, rip.radius, 0, 2 * Math.PI);
            ctx.fillStyle = `rgba(${colorStr}, ${rip.alpha})`; // 墨色
            ctx.fill();
            
            // 外轮廓发散毛边羽化特效
            ctx.beginPath();
            ctx.arc(rip.cx, rip.cy, rip.radius + 2, 0, 2 * Math.PI);
            ctx.strokeStyle = `rgba(${colorStr}, ${rip.alpha * 0.4})`;
            ctx.lineWidth = 3;
            ctx.stroke();

            // 更新动画状态
            rip.radius += rip.speed;
            rip.alpha -= 0.035;

            // 移除已淡化的动画
            if (rip.alpha <= 0 || rip.radius >= rip.maxRadius) {
                this.inkRipples.splice(k, 1);
            }
        }

        requestAnimationFrame(() => this.animateInk());
    }
}

// 页面加载完成后实例化
window.addEventListener('DOMContentLoaded', () => {
    window.app = new GoApp();
});
