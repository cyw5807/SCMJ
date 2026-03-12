import { _decorator, Component, Node, Prefab, instantiate, Label, director, find, log, Color, Button, ScrollView, Sprite, Layout, resources, SpriteFrame } from 'cc';
import { NetworkManager } from './NetworkManager';
import { CardUI } from './CardUI';
import { MainMessage, CardInfo, ActionType } from './proto/GameMessage'; 

const { ccclass, property } = _decorator;

@ccclass('GameManager')
export class GameManager extends Component {
    // --- UI 绑定 ---
    @property([Node]) seatNodes: Node[] = [];  // 展示各个玩家碰/杠/吃的【成牌区】
    @property(Node) handArea: Node = null!;    // 展示自己的 13/14 张【手牌区】
    @property(Node) centerArea: Node = null!;  // 展示场上【所有历史弃牌】的 Layout 容器
    @property(Prefab) cardPrefab: Prefab = null!;
    
    @property(SpriteFrame) public tileBackFrame: SpriteFrame | null = null; // 麻将背面的图片
    @property(SpriteFrame) public tileFrontFrame: SpriteFrame | null = null; // 麻将正面的空白底图
    
    @property([Label]) nameLabels: Label[] = [];
    @property([Label]) scoreLabels: Label[] = [];
    @property([Label]) typeLabels: Label[] = []; 
    @property([Label]) queLabels: Label[] = []; 
    
    @property(Prefab) resultPanelPrefab: Prefab = null;
    @property(Prefab) rankItemPrefab: Prefab = null;
    
    @property(Label) leftCardLabel: Label = null;  // 显示：剩余牌墙数量
    @property(Label) turnStatusLabel: Label = null; // 显示：当前是谁的回合
    @property(Label) gameCountLabel: Label = null; // 显示：局数显示组件

    @property(Button) btnPong: Button = null!; // “碰”按钮
    @property(Button) btnKong: Button = null!; // “杠”按钮
    @property(Button) btnHu: Button = null!;   // “胡”按钮（仅在有胡牌资格时显示）
    @property(Button) btnPass: Button = null!; // “过”按钮（放弃碰/杠/胡时使用）

    private netManager: NetworkManager | null = null;
    private myServerSeat: number = -1; 
    
    private selectedCardNode: Node | null = null; 
    private currentActionSeat: number = -1; 

    private myFormedSetsData: any[] = [];      // 记录副露组合
    private currentFanNames: string[] = [];
    private currentTotalFan: number = 0;
    private myQueSuit: number = -1;            // 记录我的定缺花色，-1 代表未定缺
    private isAllDingQueDone: boolean = false; // 记录全场是否定缺完毕

    private isAfterChiPong: boolean = false;   // 记录进入 3N+2 状态的原因。如果是吃/碰带来的，封锁自摸判定

    // --- 贴图缓存 ---
    // 创建一个极其可靠的内存字典，用来存储所有贴图
    private tileCache: Map<string, SpriteFrame> = new Map();
    // 贴图加载状态锁
    private isAssetsLoaded: boolean = false; 
    // 用于暂存在加载期间到达的桌面状态包
    private pendingGameStateMsg: any = null;

    // 拦截阶段的防抖锁：防止在同一个拦截窗口内连发多次 PASS
    private isInterceptLockActive: boolean = false;

    // --- 交互控制状态机 ---
    // NORMAL: 正常摸打状态 ; KONG_SELECTION: 正在选择用于杠牌的手牌
    private interactionMode: 'NORMAL'  | 'KONG_SELECTION' = 'NORMAL';
    
    // 暂存玩家当前真实的暗手牌数据列表 (你需要确保在 onReceiveGameStateSync 时把手牌存进这个变量)
    private myHandCardsData: any[] = [];

    onLoad() {
        const netNode = director.getScene().getChildByName("NetworkManager") || find("NetworkManager");
        if (netNode) {
            this.netManager = netNode.getComponent(NetworkManager);
            netNode.on("GameStateSync", this.onReceiveGameStateSync, this);
        }
        if (this.netManager) {
            this.myServerSeat = this.netManager.getMySeatIndex() === undefined ? 0 : this.netManager.getMySeatIndex();
            log(`【游戏】载入场景成功，我的座位号: ${this.myServerSeat}`);
        }
    }

    start() {
        this.loadAllMahjongTiles();

        log("【系统】GameManager 正在注册全局结算监听器...");
        director.on("FinalResult", this.onReceiveFinalResult, this);
        director.on("RoundSummary", this.onReceiveRoundSummary, this);
    }

    private loadAllMahjongTiles() {
        // 使用引擎内置的动态加载接口
        resources.loadDir("MahjongTiles", SpriteFrame, (err, assets) => {
            if (err) {
                console.error("【UI致命错误】加载麻将贴图文件夹失败！", err);
                return;
            }
            
            // 遍历加载出来的所有图片
            assets.forEach((frame) => {
                // frame.name 就是不带后缀的文件名，比如 "mj_1_1"
                this.tileCache.set(frame.name, frame);
            });
            
            console.log(`【UI系统】贴图全量加载完毕！共缓存了 ${this.tileCache.size} 张图片。`);
            this.isAssetsLoaded = true;
            
            if (this.pendingGameStateMsg) {
                console.log("【系统】贴图就绪，开始渲染暂存的桌面状态！");
                this.onReceiveGameStateSync(this.pendingGameStateMsg);
                this.pendingGameStateMsg = null; // 渲染完清空暂存器
            }
        });
    }

    /**
     * 牌节点穿透着色器
     * 无论贴图怎么覆盖，强制统一修改底板和花色的颜色
     */
    private setCardNodeTint(cardNode: Node, targetColor: Color) {
        const front = cardNode.getChildByName("Front");
        if (!front) return;

        // 1. 染底板
        const bgSprite = front.getComponent(Sprite);
        if (bgSprite) {
            bgSprite.color = targetColor;
        }

        // 2. 染花色（核心修复点：解决贴图遮挡）
        const faceNode = front.getChildByName("Face");
        if (faceNode) {
            const faceSprite = faceNode.getComponent(Sprite);
            if (faceSprite) {
                faceSprite.color = targetColor;
            }
        }
    }

    // --- 核心渲染逻辑 ---

    private onReceiveGameStateSync(msg: MainMessage) {
        // 消息拦截与暂存：如果贴图还没加载完，先把服务器发来的最新状态存起来，直接 return 中断渲染！
        if (!this.isAssetsLoaded) {
            this.pendingGameStateMsg = msg;
            console.log("【系统】贴图仍在加载中，已暂存最新的 1005 桌面同步包...");
            return; 
        }

        const data = msg.gameState;
        if (!data) return;

        // 必须在任何渲染开始前，算好所有的定缺状态！
        // ==========================================
        if (this.myServerSeat === -1 && this.netManager) {
            this.myServerSeat = this.netManager.getMySeatIndex();
        }

        // 提前算出我的定缺花色
        const myData = data.players.find(p => (p.seatIndex === undefined ? 0 : p.seatIndex) === this.myServerSeat);
        const rawSuit = myData ? (myData.queSuit === undefined ? -1 : myData.queSuit) : -1;
        this.myQueSuit = (rawSuit === 0 || rawSuit === -1) ? -1 : rawSuit;

        // 提前算出全场是否定缺完毕
        this.isAllDingQueDone = true; 
        for (let p of data.players) {
            const q = p.queSuit === undefined ? -1 : p.queSuit;
            if (q === 0 || q === -1) {
                this.isAllDingQueDone = false;
                break; 
            }
        }

        // 1. 同步全局回合状态
        this.currentActionSeat = data.currentActionSeat === undefined ? 0 : data.currentActionSeat;
        const totalPlayers = data.players.length;

        if (this.myServerSeat === -1 && this.netManager) {
            this.myServerSeat = this.netManager.getMySeatIndex();
        }

        // 2. 更新全局 UI (牌墙数量、回合提示等)
        if (this.leftCardLabel) {
            const remain = data.remainingCardsCount === undefined ? 0 : data.remainingCardsCount;
            this.leftCardLabel.string = `余 ${remain} 张`;
        }

        if (this.gameCountLabel) {
            const curMatch = data.currentMatchCount === undefined ? 0 : data.currentMatchCount;
            const totalMatch = data.totalMatchCount === undefined ? 0 : data.totalMatchCount;
            this.gameCountLabel.string = `第 ${curMatch} / ${totalMatch} 局`;
        }
        
        this.interactionMode = 'NORMAL'; // 无论如何先切回正常模式

        const isMyTurn = (this.currentActionSeat === this.myServerSeat);
        if (this.turnStatusLabel) {
            if (!isMyTurn) {
                this.turnStatusLabel.string = "回合外";
                this.turnStatusLabel.color = new Color(255, 255, 255);
            } else {
                this.turnStatusLabel.string = "请出牌";
                this.turnStatusLabel.color = new Color(255, 255, 255);
            }
        }
        if (!isMyTurn) {
            this.isAfterChiPong = false;
        }

        this.resetActionButtons();

        // 3. 清理个人牌区
        this.clearPersonalTable();

        // 重置拦截锁逻辑
        let isAnyPlayerActive = false;
        const playersList = data.players || [];
        for (let p of playersList) {
            // 极其致命的安全锁：已经胡牌的人手牌永远是 3N+2，绝对不能让他干扰活跃状态判定！
            if (p.isAlreadyHu) {
                continue; 
            }
            // 只有未胡牌且手牌为 3N+2 的人，才算是正在思考的“活跃玩家”
            if (p.handCards && p.handCards.length % 3 === 2) {
                isAnyPlayerActive = true;
                break;
            }
        }

        // 只要有人在出牌，立刻重置拦截锁，为下一次别人打牌做好准备
        if (isAnyPlayerActive) {
            this.isInterceptLockActive = false;
        }

        // 4. 遍历玩家数据，渲染各个席位
        data.players.forEach(player => {
            const sIndex = player.seatIndex === undefined ? 0 : player.seatIndex; 
            const isMe = (sIndex === this.myServerSeat);
            const logicalIndex = this.getLocalSeatIndex(sIndex, totalPlayers);

            // 渲染信息面板
            if (this.nameLabels[logicalIndex]) {
                this.nameLabels[logicalIndex].string = player.nickname || "未知玩家";
                this.nameLabels[logicalIndex].node.active = true;
            }
            if (this.scoreLabels[logicalIndex]) {
                const currentScore = player.score === undefined ? 0 : player.score; 
                this.scoreLabels[logicalIndex].string = `${currentScore} 分`;
                this.scoreLabels[logicalIndex].color = new Color(184, 134, 11); 
            }
            if (this.queLabels && this.queLabels[logicalIndex]) {
                const rawQue = player.queSuit === undefined ? -1 : player.queSuit;
                const safeQue = (rawQue === 0 || rawQue === -1) ? -1 : rawQue;
                
                // 必须同时满足“已定缺”且“全场定缺完毕”，才展示文字！
                if (safeQue !== -1 && this.isAllDingQueDone) {
                    const suitName = safeQue === 1 ? "万" : (safeQue === 2 ? "条" : "筒");
                    this.queLabels[logicalIndex].string = `${suitName}`;
                    this.queLabels[logicalIndex].node.active = true;
                } else {
                    // 全场没定完之前，哪怕他选了，也不显示！
                    this.queLabels[logicalIndex].node.active = false;
                }
            }

            // 标识是否正在行动或者已经胡牌
            if (this.typeLabels[logicalIndex]) {
                const label = this.typeLabels[logicalIndex];
                if (player.isAlreadyHu) {
                    label.string = "已胡";
                    label.color = new Color(255, 0, 0); 
                    label.node.active = true;
                } else if (sIndex === this.currentActionSeat) {
                    label.string = "思考中...";
                    label.color = new Color(0, 255, 0);
                    label.node.active = true;
                } else {
                    label.string = "等待中";
                    label.color = new Color(255, 255, 255);
                    label.node.active = true;
                }
            }

            // 渲染成牌区 (碰/杠/吃的牌)
            const seatNode = this.seatNodes[logicalIndex];
            if (seatNode) {
                seatNode.removeAllChildren(); 
                
                const fixedSets = player.fixedSets || [];
                fixedSets.forEach(cardSet => {
                    const cards = cardSet.cards ? [...cardSet.cards] : [];
                    
                    cards.sort((a, b) => {
                        const typeA = a.type === undefined ? 0 : a.type;
                        const typeB = b.type === undefined ? 0 : b.type;
                        if (typeA !== typeB) return typeA - typeB; 
                        const valA = a.value === undefined ? 0 : a.value;
                        const valB = b.value === undefined ? 0 : b.value;
                        return valA - valB; 
                    });

                    const setContainerNode = new Node("CardSetContainer");
                    const setLayout = setContainerNode.addComponent(Layout);
                    setLayout.type = Layout.Type.HORIZONTAL;
                    setLayout.resizeMode = Layout.ResizeMode.CONTAINER; 
                    setLayout.spacingX = 5; 

                    seatNode.addChild(setContainerNode);

                    cards.forEach(cardData => {
                        const cardNode = instantiate(this.cardPrefab);
                        setContainerNode.addChild(cardNode);
                        
                        cardData.type = cardData.type === undefined ? 0 : cardData.type;
                        cardData.value = cardData.value === undefined ? 0 : cardData.value;
                        this.updateCardUI(cardNode, true, cardData); 
                    });
                });
            }

            // ==========================================
            // 渲染我的手牌区及核心拦截判定
            // ==========================================
            if (isMe) {
                this.myHandCardsData = player.handCards || [];
                this.myFormedSetsData = player.fixedSets || [];

                if (this.handArea) {
                    this.handArea.removeAllChildren(); 
                }

                // 核心手牌排序与剥离算法
                const handCards = this.myHandCardsData; 
                let sortedCards: any[] = [];
                let newDrawnCard: any = null;

                // 1. 提取出公用的高级排序算法（定缺牌降维打击）
                const sortHandCardsFunc = (a: any, b: any) => {
                    const typeA = a.type === undefined ? 0 : a.type;
                    const typeB = b.type === undefined ? 0 : b.type;
                    
                    if (this.myQueSuit !== -1) {
                        if (typeA === this.myQueSuit && typeB !== this.myQueSuit) return 1;
                        if (typeA !== this.myQueSuit && typeB === this.myQueSuit) return -1;
                    }

                    if (typeA !== typeB) return typeA - typeB; 
                    
                    const valA = a.value === undefined ? 0 : a.value;
                    const valB = b.value === undefined ? 0 : b.value;
                    return valA - valB; 
                };

                // 2. 核心分支：根据是否是“碰牌后”来决定切牌顺序
                if (handCards.length % 3 === 2) {
                    if (this.isAfterChiPong) {
                        // 【场景 A：碰牌之后】
                        // 根本没有摸牌，所以先全量排序（让缺门牌沉底跑到最后），再剥离最后一张！
                        sortedCards = [...handCards];
                        sortedCards.sort(sortHandCardsFunc);
                        newDrawnCard = sortedCards.pop(); 
                    } else {
                        // 【场景 B：正常摸牌 / 杠后补牌】
                        // 服务器数组的最后一张【绝对】是真正摸上来的那张牌！
                        // 必须先把它切下来保护好，再对剩下的牌进行排序！
                        sortedCards = [...handCards];
                        newDrawnCard = sortedCards.pop(); // 先保护好真正的摸牌
                        sortedCards.sort(sortHandCardsFunc); // 剩下的牌去排队
                    }
                } else {
                    // 【场景 C：别人的回合等待中】
                    // 只有 3N + 1 张牌，直接全量排序即可
                    sortedCards = [...handCards];
                    sortedCards.sort(sortHandCardsFunc);
                }

                // 渲染生成 UI 节点
                if (this.handArea) {
                    this.handArea.removeAllChildren(); 
                }

                // 3. 渲染左侧的基础手牌区
                sortedCards.forEach(cardData => {
                    const cardNode = instantiate(this.cardPrefab);
                    this.handArea.addChild(cardNode);
                    cardNode.on(Node.EventType.TOUCH_END, this.onHandCardClick, this);
                    this.updateCardUI(cardNode, true, cardData); 
                });

                // 4. 渲染右侧被独立出来的高亮牌
                if (newDrawnCard) {
                    const cardNode = instantiate(this.cardPrefab);
                    this.handArea.addChild(cardNode);
                    cardNode.on(Node.EventType.TOUCH_END, this.onHandCardClick, this);
                    
                    // 传入 true，在 updateCardUI 里会给它叠加淡黄色的高亮滤镜 (缺牌则是暗黄)
                    this.updateCardUI(cardNode, true, newDrawnCard, true); 
                }

                // 取出我自己的状态数据
                const myData = player;
                
                // 严防 0 值干扰定缺！
                const rawSuit = myData ? (myData.queSuit === undefined ? -1 : myData.queSuit) : -1;
                this.myQueSuit = (rawSuit === 0 || rawSuit === -1) ? -1 : rawSuit;
                
                const amIAlreadyHu = myData ? myData.isAlreadyHu : false;

                // 定缺阶段拦截
                if (this.myQueSuit === -1) {
                    if (this.turnStatusLabel) {
                        this.turnStatusLabel.string = "请双击定缺";
                        this.turnStatusLabel.color = new Color(255, 255, 0); // 黄色警示
                    }
                    
                    // 执行自动检测，如果自动发了，就直接 return 等下一个 1005
                    this.checkAndAutoDingQue(handCards)
                    return; 
                }

                // 有人还未定缺，等待
                if (!this.isAllDingQueDone) {
                    if (this.turnStatusLabel) {
                        this.turnStatusLabel.string = "等待他人定缺...";
                        this.turnStatusLabel.color = new Color(200, 200, 200); 
                    }
                    this.resetActionButtons(); 
                    return; // 切断下文，禁止本地 UI 提前进入出牌状态
                }

                // 已胡牌玩家拦截
                if (amIAlreadyHu) {
                    log("【系统】我已胡牌，屏蔽所有本地状态判定！");
                    this.resetActionButtons(); 
                    return; 
                }

                const lastDiscard = data.lastDiscardedCard; 
                const remain = data.remainingCardsCount === undefined ? 0 : data.remainingCardsCount;

                // 场景 A：我的回合
                if (this.currentActionSeat === this.myServerSeat && handCards.length % 3 === 2) {
                    if (!this.isAfterChiPong) {
                        log("【系统】我的回合，执行自摸与主动判定...");
                        
                        const huResult = this.checkCanHu(handCards, null, this.myFormedSetsData); 
                        if (huResult && huResult.canHu) { 
                            this.currentTotalFan = huResult.totalFan === undefined ? 0 : huResult.totalFan;
                            this.currentFanNames = huResult.fanNames || [];
                            log(`【系统】自摸判定通过！番数: ${this.currentTotalFan}`);
                            
                            this.setActionButtonState(this.btnHu, true, 250, 33, 33); 
                            this.setActionButtonState(this.btnPass, true, 255, 255, 255);
                        }

                        if (remain > 0 && this.checkCanAnOrBuKong(handCards, this.myFormedSetsData)) {
                            log("【系统】暗杠/补杠判定通过！");
                            this.setActionButtonState(this.btnKong, true, 252, 222, 69); 
                            this.setActionButtonState(this.btnPass, true, 255, 255, 255);
                        }
                    }
                }
                
                // 场景 B：别人的回合 (此处的 !isAnyPlayerActive 现在绝对精准！)
                else if (this.currentActionSeat !== this.myServerSeat && handCards.length % 3 === 1 && lastDiscard && !isAnyPlayerActive) {
                    log("【系统】他人回合，执行外部拦截判定...");

                    let hasAnyAction = false;
                    
                    const huResult = this.checkCanHu(handCards, lastDiscard, this.myFormedSetsData); 
                    if (huResult && huResult.canHu) { 
                        this.currentTotalFan = huResult.totalFan === undefined ? 0 : huResult.totalFan;
                        this.currentFanNames = huResult.fanNames || [];
                        log(`【系统】点炮判定通过！番数: ${this.currentTotalFan}`);
                        
                        this.setActionButtonState(this.btnHu, true, 250, 33, 33); 
                        this.setActionButtonState(this.btnPass, true, 255, 255, 255);
                        hasAnyAction = true;
                    }

                    if (remain > 0) { 
                        if (this.checkCanMingKong(handCards, lastDiscard)) {
                            log("【系统】明杠判定通过！");
                            this.setActionButtonState(this.btnKong, true, 252, 222, 69);
                            this.setActionButtonState(this.btnPass, true, 255, 255, 255);
                            hasAnyAction = true;
                        }

                        if (this.checkCanPong(handCards, lastDiscard)) {
                            log("【系统】碰牌判定通过！");
                            this.setActionButtonState(this.btnPong, true, 36, 141, 255); 
                            this.setActionButtonState(this.btnPass, true, 255, 255, 255);
                            hasAnyAction = true;
                        }
                    }

                    if (!hasAnyAction) {
                        if (!this.isInterceptLockActive) {
                            log("【系统】无任何可拦截操作，前端自动发送“过”放行状态机...");
                            this.isInterceptLockActive = true; 
                            
                            if (this.netManager) {
                                this.netManager.sendPlayerAction(ActionType.PASS);
                            }
                        }
                    }
                }
            }
        });

        // 5. 基于后端的渲染逻辑
        const historyDiscards = data.globalDiscardedCards || [];
        const currentUINodesCount = this.centerArea ? this.centerArea.children.length : 0;

        if (historyDiscards.length === 0 && this.centerArea) {
            this.centerArea.removeAllChildren();
        } 
        else if (historyDiscards.length > currentUINodesCount) {
            for (let i = currentUINodesCount; i < historyDiscards.length; i++) {
                this.appendDiscardedCard(historyDiscards[i]);
            }
        }
        else if (historyDiscards.length < currentUINodesCount) {
            if (this.centerArea) this.centerArea.removeAllChildren();
            historyDiscards.forEach(card => this.appendDiscardedCard(card));
        }

        this.highlightLastDiscard();
    }

    /**
     * 检测手牌，如果天生缺某门，立刻静默向服务器发送定缺包
     * @returns boolean 是否触发了自动定缺
     */
    private checkAndAutoDingQue(handCards: any[]) {
        // 严格映射：1(万), 2(条), 3(筒)
        const suitCounts = { 1: 0, 2: 0, 3: 0 }; 
        
        handCards.forEach(c => {
            // 安全过滤：防范 undefined 或异常牌型
            if (c.type === 1 || c.type === 2 || c.type === 3) {
                suitCounts[c.type]++;
            }
        });

        // 寻找哪一门数量为 0
        for (const suitStr in suitCounts) {
            const suit = parseInt(suitStr);
            if (suitCounts[suit] === 0) {
                log(`【系统】天生缺花色 ${suit}，自动上报定缺！`);
                
                // 给服务器发送定缺包，type 稳稳的是 1/2/3 中的一个
                if (this.netManager) {
                    this.netManager.sendPlayerAction(ActionType.DING_QUE, { type: suit, value: 1 });
                }
                return true; 
            }
        }
        return false; 
    }

    /**
     * 检查是否可以暗杠或补杠 (自己回合内调用)
     * @param handCards 玩家当前的暗手牌数组
     * @param formedSets 玩家已经摆在桌面的组合数组
     * @returns boolean
     */
    private checkCanAnOrBuKong(handCards: any[], formedSets: any[]): boolean {
        // 安全拦截：防范空指针与无效数组
        if (!handCards || handCards.length === 0) return false;

        // 过滤掉所有属于缺门花色的牌
        const validHandCards = handCards.filter(c => c.type !== this.myQueSuit);
        
        // 如果把缺牌全过滤完之后，手里没牌了，直接返回 false
        if (validHandCards.length === 0) return false;

        // 1. 数据收集阶段：使用 Map 统计手中每张【有效牌】的数量
        // Key 格式为 "type_value" (例如万子3就是 "1_3")，Value 为数量
        const cardCountMap = new Map<string, number>();

        for (let c of validHandCards) {
            const cType = c.type === undefined ? 0 : c.type;
            const cVal = c.value === undefined ? 0 : c.value;
            const key = `${cType}_${cVal}`;
            
            const currentCount = cardCountMap.get(key) || 0;
            cardCountMap.set(key, currentCount + 1);
        }

        // 2. 逻辑判定阶段：遍历统计好的字典
        for (let [key, count] of cardCountMap.entries()) {
            
            // 场景 A：暗杠判定
            // 只要某种有效牌在手里达到了 4 张，立刻触发短路返回
            if (count === 4) {
                return true;
            }

            // 场景 B：补杠判定
            // 如果手中有这张有效牌 (count >= 1)，我们需要去副露区寻找是否碰过它
            if (count >= 1 && formedSets && formedSets.length > 0) {
                // 解析出当前这张牌的真实 type 和 value
                const parts = key.split('_');
                const cType = parseInt(parts[0], 10);
                const cVal = parseInt(parts[1], 10);

                for (let set of formedSets) {
                    if (!set.cards || set.cards.length === 0) continue;
                    // 注意这里的 ActionType.DRAW 是你原代码的兜底，保持不变
                    const setType = set.type === undefined ? ActionType.DRAW : set.type;
                    
                    // 这里判断副露的类型是否为碰牌 (PONG)
                    if (setType === ActionType.PONG && set.cards && set.cards.length > 0) {
                        const setCardType = set.cards[0].type === undefined ? 0 : set.cards[0].type;
                        const setCardVal = set.cards[0].value === undefined ? 0 : set.cards[0].value;
                        
                        // 碰牌的花色和数值与手中的这张有效牌完全一致
                        if (setCardType === cType && setCardVal === cVal) {
                            return true;
                        }
                    }
                }
            }
        }

        return false;
    }

    /**
     * 检查是否可以明杠 (别人打出牌时调用)
     * @param handCards 玩家当前的暗手牌数组
     * @param targetCard 别人刚打出的那张牌
     * @returns boolean
     */
    private checkCanMingKong(handCards: any[], targetCard: any): boolean {
        if (!handCards || !targetCard) return false;

        if (this.myQueSuit !== -1 && targetCard.type === this.myQueSuit) {
            return false;
        }

        const targetType = targetCard.type === undefined ? 0 : targetCard.type;
        const targetVal = targetCard.value === undefined ? 0 : targetCard.value;
        let matchCount = 0;

        // 遍历暗手牌寻找完全匹配的牌
        for (let c of handCards) {
            const cType = c.type === undefined ? 0 : c.type;
            const cVal = c.value === undefined ? 0 : c.value;
            
            if (cType === targetType && cVal === targetVal) {
                if (++matchCount === 3) {
                    return true;
                }
            }
        }
        
        // 如果遍历完整个手牌，matchCount 仍未达到 3，则判定失败
        return false;
    }

    /**
     * 检查是否可以碰牌 (别人打出牌时调用)
     * @param handCards 玩家当前的暗手牌数组
     * @param targetCard 别人刚打出的那张牌
     * @returns boolean
     */
    private checkCanPong(handCards: any[], targetCard: any): boolean {
        if (!handCards || !targetCard) return false;

        if (this.myQueSuit !== -1 && targetCard.type === this.myQueSuit) {
            return false;
        }

        const targetType = targetCard.type === undefined ? 0 : targetCard.type;
        const targetVal = targetCard.value === undefined ? 0 : targetCard.value;
        let matchCount = 0;

        // 遍历暗手牌寻找完全匹配的牌
        for (let c of handCards) {
            const cType = c.type === undefined ? 0 : c.type;
            const cVal = c.value === undefined ? 0 : c.value;
            
            if (cType === targetType && cVal === targetVal) {
                if (++matchCount === 2) {
                    return true;
                }
            }
        }
        
        // 如果遍历完整个手牌，matchCount 仍未达到 2，则判定失败
        return false;
    }

    /**
     * 追加单张弃牌到公共牌池 Layout
     */
    private appendDiscardedCard(cardData: CardInfo) {
        if (!this.centerArea) return;
        const cardNode = instantiate(this.cardPrefab);
        this.centerArea.addChild(cardNode);
        this.updateCardUI(cardNode, true, cardData);
    }

    /**
     * 刷新牌河高亮：仅将最后一张打出的牌设为淡黄色
     */
    private highlightLastDiscard() {
        if (!this.centerArea || this.centerArea.children.length === 0) return;

        // 1. 先把牌河里所有的牌“洗白”，恢复成正常的纯白色
        this.centerArea.children.forEach(cardNode => {
            this.setCardNodeTint(cardNode, Color.WHITE);
        });

        // 2. 揪出最后一张被打出的牌（数组里的最后一个节点）
        const lastCardNode = this.centerArea.children[this.centerArea.children.length - 1];
        
        // 3. 将其高亮为极其舒适的淡黄色
        this.setCardNodeTint(lastCardNode, new Color(255, 255, 150));
    }

    // --- 交互与操作逻辑 ---

    private onHandCardClick(event: any) {
        const cardNode = event.target as Node;
        let cardUI = cardNode.getComponent(CardUI) || cardNode.parent?.getComponent(CardUI);

        if (cardUI && cardUI.node.parent === this.handArea) {
            
            // 定缺阶段的手牌点击劫持
            if (this.myQueSuit === -1) {
                // 如果是定缺阶段，禁止出牌，点击牌只代表选择花色
                if (this.selectedCardNode === cardUI.node) {
                    // 两次点击同一张牌：确认定缺！
                    log(`【系统】玩家手动双击，定缺花色: ${cardUI.type}`);
                    
                    if (this.netManager) {
                        this.netManager.sendPlayerAction(ActionType.DING_QUE, { type: cardUI.type, value: 1 });
                    }

                    this.myQueSuit = cardUI.type; 
                    
                    this.selectedCardNode = null;
                    cardUI.resetState();
                } else {
                    // 首次点击：弹起
                    if (this.selectedCardNode) {
                        this.selectedCardNode.getComponent(CardUI)?.resetState(); 
                    }
                    cardUI.toggleSelect(); // 弹起
                    this.selectedCardNode = cardUI.node;
                }
                return; // 劫持成功，绝对禁止走到下面的出牌逻辑！
            }

            if (!this.isAllDingQueDone) {
                log("提示：等待其他玩家定缺...");
                // 允许看牌（弹起），但绝不允许走入下方的 DISCARD 出牌逻辑
                if (this.selectedCardNode === cardUI.node) {
                     this.selectedCardNode = null;
                     cardUI.resetState();
                } else {
                     if (this.selectedCardNode) this.selectedCardNode.getComponent(CardUI)?.resetState();
                     cardUI.toggleSelect();
                     this.selectedCardNode = cardUI.node;
                }
                return;
            }

            // 拦截杠牌选择
            if (this.interactionMode === 'KONG_SELECTION') {
                this.handleKongCardSelection(cardUI);
                return;
            }

            // 正常出牌逻辑
            
            // --- 核心逻辑 1：二次点击确认打出 ---
            if (this.selectedCardNode === cardUI.node && cardUI.isSelected) {
                
                if (this.currentActionSeat !== this.myServerSeat) {
                    log("提示：还没轮到你出牌！");
                    cardUI.resetState();
                    this.selectedCardNode = null;
                    return;
                }

                if (this.handArea.children.length % 3 !== 2) {
                    log(`提示：当前手牌数为 ${this.handArea.children.length}，不符合出牌状态！`);
                    cardUI.resetState();
                    this.selectedCardNode = null;
                    return;
                }

                if (this.netManager) {
                    const cardInfo = { type: cardUI.type, value: cardUI.value }; 
                    log(`【动作】打出手牌: ${this.getMahjongCardStr(cardInfo.type, cardInfo.value)}`);
                    
                    this.netManager.sendPlayerAction(ActionType.DISCARD, cardInfo);
                    
                    this.selectedCardNode = null;
                    this.isAfterChiPong = false;
                    this.resetActionButtons();
                }
                return;
            }

            // --- 核心逻辑 2：唯一选中弹起 ---
            log(`【交互】选中手牌: ${this.getMahjongCardStr(cardUI.type, cardUI.value)}`);
            
            if (this.selectedCardNode && this.selectedCardNode !== cardUI.node) {
                this.selectedCardNode.getComponent(CardUI)?.resetState();
            }

            if (!cardUI.isSelected) {
                cardUI.toggleSelect(); 
            }
            this.selectedCardNode = cardUI.node;
        }
    }

    /**
     * 处理杠牌模式下的二次点击与算数校验
     */
    private handleKongCardSelection(cardUI: any) {
        // 1. 切换目标时，重置旧的弹起状态
        if (this.selectedCardNode && this.selectedCardNode !== cardUI.node) {
            this.selectedCardNode.getComponent(CardUI)?.resetState();
            this.selectedCardNode = null;
        }

        // 2. 第一次点击：弹起
        if (!cardUI.isSelected) {
            cardUI.toggleSelect();
            this.selectedCardNode = cardUI.node;
            return;
        }

        // 3. 第二次点击同一张牌：确认杠牌！
        const targetType = cardUI.type === undefined ? 0 : cardUI.type;
        const targetVal = cardUI.value === undefined ? 0 : cardUI.value;

        // 情况 A：是否构成暗杠（手牌中有 4 张同样的牌）
        let handMatchCount = 0;
        for (let c of this.myHandCardsData) {
            const cType = c.type === undefined ? 0 : c.type;
            const cVal = c.value === undefined ? 0 : c.value;
            if (cType === targetType && cVal === targetVal) {
                handMatchCount++;
            }
        }

        let isValidKong = false;
        let kongTypeStr = "";

        if (handMatchCount === 4) {
            isValidKong = true;
            kongTypeStr = "暗杠";
        } else {
            // 情况 B：是否构成补杠（手牌中有 1 张，且副露区有对应的碰牌）
            if (handMatchCount >= 1 && this.myFormedSetsData) {
                for (let set of this.myFormedSetsData) {
                    // 检查碰的牌是不是目标牌
                    if (set.type === ActionType.PONG && set.cards && set.cards.length > 0) {
                        const setCardType = set.cards[0].type === undefined ? 0 : set.cards[0].type;
                        const setCardVal = set.cards[0].value === undefined ? 0 : set.cards[0].value;
                        if (setCardType === targetType && setCardVal === targetVal) {
                            isValidKong = true;
                            kongTypeStr = "补杠";
                            break;
                        }
                    }
                }
            }
        }

        // 4. 判决执行
        if (isValidKong) {
            log(`【系统】审查通过！执行${kongTypeStr}，牌型: ${targetType}+${targetVal}`);
            
            // 直接平铺传参即可
            const actionData = {
                type: targetType, 
                value: targetVal
            };
            
            if (this.netManager) {
                this.netManager.sendPlayerAction(ActionType.KONG, actionData);
            }
            
            this.resetActionButtons();
            this.cancelSelectionMode(); // 通用的取消模式函数
            
        } else {
            // 审查不通过：不符合暗杠或补杠条件，撤销操作，打回原位
            log(`【系统】违规操作：手牌 ${targetVal} 不符合暗杠或补杠条件！`);
            this.cancelSelectionMode();
        }
    }

    /**
     * 统一的取消选择状态
     */
    private cancelSelectionMode() {
        this.interactionMode = 'NORMAL';
        const isMyTurn = (this.currentActionSeat === this.myServerSeat);
        if (this.turnStatusLabel) {
            if (!isMyTurn) {
                this.turnStatusLabel.string = "回合外";
                this.turnStatusLabel.color = new Color(255, 255, 255);
            } else {
                this.turnStatusLabel.string = "请出牌";
                this.turnStatusLabel.color = new Color(255, 255, 255);
            }
        }
        if (this.selectedCardNode) {
            this.selectedCardNode.getComponent(CardUI)?.resetState();
            this.selectedCardNode = null;
        }
    }
    
    /** 绑定到“碰”按钮 */
    public onBtnAction_Pong() {
        if (this.netManager) {
            log("【动作】发送碰牌指令...");

            this.isAfterChiPong = true;
            this.netManager.sendPlayerAction(ActionType.PONG);
            this.resetActionButtons();
            this.cancelSelectionMode(); // 防御性清理
        }
    }

    /** 绑定到“杠”按钮 */
    public onBtnAction_Kong() {
        if (this.currentActionSeat !== this.myServerSeat) {
            // 场景 1：非自己回合，绝对是明杠，直接向服务器提交动作申请
            if (this.netManager) {
                log("【动作】发送明杠指令...");
                this.netManager.sendPlayerAction(ActionType.KONG);
                this.resetActionButtons();
            }
        } else {
            // 场景 2：自己回合，可能是暗杠或补杠，进入“证据审查”交互模式
            this.interactionMode = 'KONG_SELECTION';
            if (this.turnStatusLabel) {
                this.turnStatusLabel.string = "补杠/暗杠";
                this.turnStatusLabel.color = new Color(252, 222, 69); // 和杠按钮同色的提示
            }
            log("【交互】进入杠牌模式！请点击手牌中需要杠的牌...");
        }
    }

    // “胡”按钮的核心逻辑：发送胡牌指令
    public onBtnAction_Hu() {
        if (this.netManager) {
            log(`【动作】发送胡牌指令！番数: ${this.currentTotalFan}`);
            
            // 构建带番型数据的请求载荷
            const actionData = {
                action: ActionType.HU,
                totalFan: this.currentTotalFan === undefined ? 0 : this.currentTotalFan,
                fanNames: this.currentFanNames || []
            };
            
            // 发送给服务器
            this.netManager.sendPlayerAction(ActionType.HU, actionData);
            
            // 发送后立刻置灰，防误触
            this.resetActionButtons(); 
        }
    }

    // “过”按钮的核心逻辑：发送过牌指令（如果当前有碰/杠/胡资格），或者仅重置 UI 状态（如果处于吃/杠牌选择模式）
    public onBtnAction_Pass() {
        if (this.netManager) {
            log("【动作】发送过牌指令...");
            this.interactionMode = 'NORMAL'; // 无论如何先切回正常模式

            const isMyTurn = (this.currentActionSeat === this.myServerSeat);
            if (this.turnStatusLabel) {
                if (!isMyTurn) {
                    this.turnStatusLabel.string = "回合外";
                    this.turnStatusLabel.color = new Color(255, 255, 255);
                } else {
                    this.turnStatusLabel.string = "请出牌";
                    this.turnStatusLabel.color = new Color(255, 255, 255);
                }
            }

            this.netManager.sendPlayerAction(ActionType.PASS);
            this.resetActionButtons();
            this.cancelSelectionMode(); // 彻底退出吃牌选择模式并放下牌
            log("【交互】玩家选择了过，放弃当前所有拦截权限。");
        }
    }

    // --- 结算与 UI 弹窗 ---

    private onReceiveRoundSummary(msg: MainMessage) {
        const summary = msg.roundSummary;
        if (!summary) {
            console.error("【UI致命错误】收到 1008 包，但 roundSummary 为空！");
            return;
        }

        // 【核心诊断】：把解析出来的对象全量打印到控制台
        console.log("【结算数据接收】1008 战报明细:", JSON.stringify(summary));

        // 如果发现没有 winners 字段，100% 是前端没有重新编译 Protobuf
        if (summary.winners === undefined) {
            console.error("【协议严重错位】找不到 winners 字段！请立即在前端重新编译 .proto 文件！");
        }

        // 1. 生成底层：全局分数变动大面板 (ROUND_SCORES)
        // 使用 || [] 兜底，防止 undefined 导致崩溃
        const sortedScores = summary.scores ? [...summary.scores] : [];
        sortedScores.sort((a, b) => {
            const scoreA = a.scoreChange === undefined ? 0 : a.scoreChange;
            const scoreB = b.scoreChange === undefined ? 0 : b.scoreChange;
            return scoreB - scoreA; 
        });
        
        this.showResultPanel('ROUND_SCORES', sortedScores, null);

        // 2. 生成顶层：胡牌展示 (WINNER_DETAIL)
        const winnersList = summary.winners || [];
        if (winnersList.length > 0) {
            winnersList.forEach((winnerInfo) => {
                this.showResultPanel('WINNER_DETAIL', [], winnerInfo);
            });
        } else {
            console.log("【状态揭秘】没有胡牌玩家数据，仅展示分数底板（这说明要么是流局，要么是协议没对齐）");
        }
    }

    private onReceiveFinalResult(msg: MainMessage) {
        const result = msg.finalResult; 
        if (!result) return;

        log(`【终局结算】总冠军: ${result.winnerNickname}`);
        const mockScores = result.leaderBoard.map(info => ({
            nickname: info.nickname, 
            scoreChange: 0,
            currentTotalScore: info.totalScore,
            rank: info.rank
        }));
        
        // 生成终局榜单 (FINAL)
        this.showResultPanel('FINAL', mockScores, `游戏结束！最终赢家: ${result.winnerNickname}`);
    }

    /**
     * @param renderType 面板形态：'FINAL' | 'ROUND_SCORES' | 'WINNER_DETAIL'
     * @param scoresList 排行榜分数数据
     * @param detailData 详情数据 (WINNER_DETAIL 传入 WinnerDetail 对象，FINAL 传入标题字符串)
     */
    private showResultPanel(renderType: string, scoresList: any[], detailData: any) {
        const panelNode = instantiate(this.resultPanelPrefab);
        this.node.addChild(panelNode); // 后添加的节点层级自动在最上层

        // 根据你的结构，精准获取 Leaderboard 节点
        const leaderboardNode = panelNode.getChildByName("Leaderboard");
        if (!leaderboardNode) return;

        // 根据你的结构，所有的核心 UI 组件都是 Leaderboard 的直接子节点
        const titleLabel = leaderboardNode.getChildByName("Title")?.getComponent(Label);
        const cardsArea = leaderboardNode.getChildByName("WinningCardsArea");
        const confirmBtnNode = leaderboardNode.getChildByName("ConfirmButton");
        const btnLabel = confirmBtnNode?.getComponentInChildren(Label);
        
        // 精准定位滑动列表的视觉表现节点
        const viewNode = leaderboardNode.getChildByName("view");
        const scrollBarNode = leaderboardNode.getChildByName("scrollBar");
        
        // ScrollView 组件极大概率挂载在 leaderboardNode 上，兜底向下查找
        const scrollView = leaderboardNode.getComponent(ScrollView) || panelNode.getComponentInChildren(ScrollView);

        // ==========================================
        // 1. 标题与排版控制
        // ==========================================
        if (titleLabel) {
            if (renderType === 'WINNER_DETAIL' && detailData) {
                const fanStr = (detailData.fanNames && detailData.fanNames.length > 0) ? detailData.fanNames.join(" + ") : "平胡";
                const tFan = detailData.totalFan === undefined ? 0 : detailData.totalFan;
                
                const sIndex = detailData.seatIndex === undefined ? 0 : detailData.seatIndex;
                
                titleLabel.string = `座位 ${sIndex} 胡牌详情: ${fanStr} (${tFan}番)`;
            } else if (renderType === 'ROUND_SCORES') {
                titleLabel.string = "本局分数结算";
            } else if (renderType === 'FINAL') {
                titleLabel.string = typeof detailData === 'string' ? detailData : "游戏结束：最终排名";
            }
        }

        // ==========================================
        // 2. 渲染排行榜分数 (仅对 FINAL 和 ROUND_SCORES 开启)
        // ==========================================
        const isListVisible = (renderType !== 'WINNER_DETAIL');
        
        // 【核心修复】：绝不能碰 scrollView.node.active！
        // 只精准隐藏滑动视口和滚动条，完美保留 Leaderboard 下的按钮和标题
        if (viewNode) viewNode.active = isListVisible;
        if (scrollBarNode) scrollBarNode.active = isListVisible;
        
        if (isListVisible && scrollView && scrollView.content) {
            const content = scrollView.content;
            content.removeAllChildren(); 
            scoresList.forEach((info, index) => {
                const item = instantiate(this.rankItemPrefab);
                content.addChild(item); 

                const label = item.getComponentInChildren(Label);
                if (label) {
                    const sIndex = info.seatIndex === undefined ? 0 : info.seatIndex;
                    const name = info.nickname ? info.nickname : `座位 ${sIndex}`;
                    const changeVal = info.scoreChange === undefined ? 0 : info.scoreChange;
                    const changeStr = changeVal > 0 ? `+${changeVal}` : `${changeVal}`;
                    const totalStr = info.currentTotalScore === undefined ? 0 : info.currentTotalScore;
                    
                    if (renderType === 'ROUND_SCORES') {
                        label.string = `${index + 1}. ${name} / 本局 ${changeStr} / 总分 ${totalStr}`;
                    } else {
                        label.string = `${index + 1}. ${name} ——  ${totalStr} 分`;
                    }
                    label.color = (index === 0) ? new Color(165, 154, 25) : new Color(0, 0, 0);
                }
            });
        }

        // ==========================================
        // 3. 渲染赢家的牌型结构 (仅对 WINNER_DETAIL 开启)
        // ==========================================
        if (cardsArea) {
            cardsArea.active = (renderType === 'WINNER_DETAIL'); 
            
            if (cardsArea.active && detailData) {
                cardsArea.removeAllChildren();
                
                // A. 渲染副露 (碰/杠)
                const melds = detailData.melds || [];
                melds.forEach((meld: any) => {
                    const mCards = meld.cards || [];
                    mCards.forEach((c: any) => {
                        const node = instantiate(this.cardPrefab);
                        cardsArea.addChild(node);
                        c.type = c.type === undefined ? 0 : c.type;
                        c.value = c.value === undefined ? 0 : c.value;
                        this.updateCardUI(node, true, c, false);
                    });
                });

                // B. 渲染暗手牌
                const handCards = detailData.handCards || [];
                handCards.sort((a: any, b: any) => {
                    const typeA = a.type === undefined ? 0 : a.type;
                    const typeB = b.type === undefined ? 0 : b.type;
                    if (typeA !== typeB) return typeA - typeB;
                    const valA = a.value === undefined ? 0 : a.value;
                    const valB = b.value === undefined ? 0 : b.value;
                    return valA - valB;
                });
                
                handCards.forEach((c: any) => {
                    const node = instantiate(this.cardPrefab);
                    cardsArea.addChild(node);
                    c.type = c.type === undefined ? 0 : c.type;
                    c.value = c.value === undefined ? 0 : c.value;
                    this.updateCardUI(node, true, c, false);
                });

                // C. 渲染目标牌 (高亮淡黄色)
                if (detailData.winningCard) {
                    const winCard = detailData.winningCard;
                    const node = instantiate(this.cardPrefab);
                    cardsArea.addChild(node);
                    winCard.type = winCard.type === undefined ? 0 : winCard.type;
                    winCard.value = winCard.value === undefined ? 0 : winCard.value;
                    this.updateCardUI(node, true, winCard, true); 
                }
            }
        }

        // ==========================================
        // 4. 按钮文字替换与交互绑定
        // ==========================================
        if (confirmBtnNode) {
            if (btnLabel) {
                if (renderType === 'WINNER_DETAIL') btnLabel.string = "关闭详情";
                else if (renderType === 'ROUND_SCORES') btnLabel.string = "准备下一局";
                else btnLabel.string = "返回大厅";
            }

            confirmBtnNode.on(Button.EventType.CLICK, () => {
                if (renderType === 'ROUND_SCORES' && this.netManager) {
                    log("【交互】玩家点击继续，发送准备下一局指令 (1009)");
                    this.netManager.sendReadyNextMatch();
                    
                    this.resetActionButtons(); 
                    if (this.turnStatusLabel) {
                        this.turnStatusLabel.string = "等待其他玩家确认...";
                        this.turnStatusLabel.color = new Color(255, 255, 0); 
                    }
                } else if (renderType === 'FINAL') {
                    log("【交互】终局退出，返回大厅");
                    director.loadScene("LobbyScene");
                }
                
                // 点击后销毁当前层级的面板，露出底下的其他面板
                panelNode.destroy();
            }, this);
        }
    }

    // --- 视觉与数据转换辅助 ---

    private updateCardUI(cardNode: Node, isFaceUp: boolean, info: any, isNewlyDrawn: boolean = false) {
        // 1. 基础信息赋值
        const cardUI = cardNode.getComponent(CardUI); 
        if (cardUI && info) {
            cardUI.type = info.type; 
            cardUI.value = info.value;
        }

        // 2. 节点获取
        const front = cardNode.getChildByName("Front");
        const back = cardNode.getChildByName("Back");
        if (!front || !back) return;

        // 3. 明暗牌翻转
        front.active = isFaceUp;
        back.active = !isFaceUp;

        if (!isFaceUp) return; 

        // 4. 获取正面的各个渲染组件
        const bgSprite = front.getComponent(Sprite);
        const labelNode = front.getChildByName("ValueLabel"); 
        const label = labelNode ? labelNode.getComponent(Label) : null;
        
        const faceNode = front.getChildByName("Face");
        const faceSprite = faceNode ? faceNode.getComponent(Sprite) : null;

        // 5. 核心容错渲染逻辑：贴图优先，文字保底
        let hasTexture = false;

        if (info && info.type !== undefined) {
            const spriteName = `mj_${info.type}_${info.value}`;
            const frame = this.tileCache.get(spriteName);
            
            if (frame && faceSprite) {
                faceSprite.spriteFrame = frame;
                hasTexture = true;
            }
        }

        if (faceNode) faceNode.active = hasTexture;
        
        if (labelNode && label) {
            labelNode.active = !hasTexture; 
            if (!hasTexture) {
                label.string = this.getMahjongCardStr(info.type, info.value);
                const colors = [Color.WHITE, new Color(220, 20, 60), new Color(30, 144, 255), new Color(34, 139, 34), Color.BLACK];
                label.color = colors[info.type] || Color.BLACK;
            }
        }

        // 6. 定缺灰阶遮罩与高亮着色逻辑
        // 判定这张牌是否属于我的缺门花色
        const isQueCard = (this.isAllDingQueDone && this.myQueSuit !== -1 && info && info.type === this.myQueSuit);
        
        let tintColor = Color.WHITE;

        if (isQueCard) {
            // 是缺门牌：蒙上灰色
            if (isNewlyDrawn) {
                // 新摸的缺门牌：淡黄色高亮 + 灰阶叠加 (RGB调为暗黄偏灰)
                tintColor = new Color(180, 180, 130); 
            } else {
                // 普通手牌里的缺门牌：纯灰色
                // 如果你觉得不够黑，减小所有参数；如果你觉得太黑看不清牌面了，增大所有参数
                tintColor = new Color(170, 170, 170); 
            }
        } else {
            // 正常牌
            if (isNewlyDrawn) {
                // 新摸的正常牌：明亮的淡黄色高亮
                tintColor = new Color(255, 255, 150); 
            } else {
                // 普通牌：恢复纯白无遮罩
                tintColor = Color.WHITE; 
            }
        }

        // 统一应用颜色
        if (bgSprite) {
            bgSprite.color = tintColor;
        }
        if (faceSprite) {
            // 确保花色贴图也一起变色，增强融合感
            faceSprite.color = tintColor; 
        }
    }

    private getMahjongCardStr(type: number, value: number): string {
        const types = ["", "万", "筒", "条", ""];
        if (type === 4) {
            const zi = ["", "东", "南", "西", "北", "中", "发", "白"];
            return zi[value] || "?";
        }
        return value.toString() + types[type];
    }

    /**
     * 极其明显的按钮视觉控制
     * isActive = true: 恢复原本鲜艳颜色，可以点击
     * isActive = false: 变成纯灰白/变暗，无法点击
     */
    private setActionButtonState(btn: Button, isActive: boolean, r?: number, g?: number, b?: number) {
        if (!btn || !btn.node) return;

        // 1. 控制真实交互权限
        btn.node.active = true; 
        btn.interactable = isActive;

        // 2. 强力控制视觉表现
        const sprite = btn.getComponent(Sprite);
        if (sprite) {
            // 开启 Cocos 原生的灰度滤镜
            sprite.grayscale = !isActive; 

            // 【安全防御】极其严格的 number 兜底转换，全部默认置为 0
            const safeR = r === undefined ? 0 : r;
            const safeG = g === undefined ? 0 : g;
            const safeB = b === undefined ? 0 : b;

            // 亮起时使用传入的专属颜色，暗去时使用统一的深灰色
            sprite.color = isActive ? new Color(safeR, safeG, safeB, 255) : new Color(120, 120, 120, 255);
        }
    }

    /**
     * 重置所有操作按钮（默认显示，但置灰不可交互）
     */
    private resetActionButtons() {
        if (this.btnPong) this.setActionButtonState(this.btnPong, false);
        if (this.btnKong) this.setActionButtonState(this.btnKong, false);
        if (this.btnHu)   this.setActionButtonState(this.btnHu, false);
        if (this.btnPass) this.setActionButtonState(this.btnPass, false);
    }

    private getLocalSeatIndex(serverSeat: number, totalPlayers: number): number {
        if (this.myServerSeat === -1 || totalPlayers <= 0) return 0;
        return ((serverSeat - this.myServerSeat + totalPlayers) % totalPlayers);
    }

    /**
     * 【修改】仅清理个人区域的手牌和成牌区，公牌区交由增量逻辑维护
     */
    private clearPersonalTable() {
        this.seatNodes.forEach(node => node.removeAllChildren());
        this.handArea.removeAllChildren();
    }

    onDestroy() {
        director.off("FinalResult", this.onReceiveFinalResult, this);
        director.off("RoundSummary", this.onReceiveRoundSummary, this);
    }

    /**
     * 自定义胡牌检测逻辑
     * @param handCards 玩家当前的暗手牌数组
     * @param targetCard 别人打出的目标牌 (如果是自摸，则传 null)
     * @param formedSets 玩家已经摆在桌面的组合数组 (吃、碰、杠)
     * @returns 判定结果、总番数、番型名称列表
     */
    private checkCanHu(handCards: any[], targetCard: any | null, formedSets: any[]): { canHu: boolean, totalFan: number, fanNames: string[] } {
        // 安全拦截
        if (!handCards) return { canHu: false, totalFan: 0, fanNames: [] };
        
        // 拼装成待检测的完整数组
        let canHu = false;
        let totalFan = 0;
        let fanNames: string[] = [];

        log("【胡牌检测】手牌参数:", handCards);
        log("【胡牌检测】目标牌参数:", targetCard);

        // 1. 拼装基础检测数组 (checkArray)
        // 用途：执行回溯拆解，验证是否满足基础胡牌结构
        let checkArray = handCards.map(card => ({
            type: card.type === undefined ? 0 : card.type,
            value: card.value === undefined ? 0 : card.value
        }));

        if (targetCard) {
            checkArray.push({
                type: targetCard.type === undefined ? 0 : targetCard.type,
                value: targetCard.value === undefined ? 0 : targetCard.value
            });
        } 
        // else{  // 川麻暂时用不到
        //     // 自摸的时候，目标牌就是手牌里新摸的那张牌，读取过来存入targetCard变量，方便后续算法使用
        //     if (handCards.length > 0) {
        //         const lastCard = handCards[handCards.length - 1];
        //         targetCard = {
        //             type: lastCard.type === undefined ? 0 : lastCard.type,
        //             value: lastCard.value === undefined ? 0 : lastCard.value
        //         };
        //         log("【胡牌检测】自摸场景，自动将最后一张手牌作为目标牌:", targetCard);
        //     } else {
        //         log("【胡牌检测】自摸场景，但手牌数组为空，无法确定目标牌！");
        //     }
        // }

        // 2. 拼装全局统计数组 (totalArray)
        // 用途：在基础牌型成立后，统计整副牌的花色、刻子等特征用于算番
        // 首先克隆一份 checkArray 的数据
        let totalArray = checkArray.map(card => ({
            type: card.type === undefined ? 0 : card.type,
            value: card.value === undefined ? 0 : card.value
        }));
        
        // 安全读取副露区数据
        const safeFormedSets = formedSets || [];
        for (let set of safeFormedSets) {
            // 确保该副露组合存在有效的卡牌数组
            if (set.cards && Array.isArray(set.cards)) {
                for (let card of set.cards) {
                    // 将副露区的所有牌安全地推入全量数组
                    totalArray.push({
                        type: card.type === undefined ? 0 : card.type,
                        value: card.value === undefined ? 0 : card.value
                    });
                }
            }
        }

        // 先按类型，再按数值从小到大排序整个数组，方便后续算法处理
        // 此时所有 undefined 已经变成数字 0，无需额外判断
        checkArray.sort((a, b) => {
            if (a.type !== b.type) return a.type - b.type;
            return a.value - b.value;
        });

        // 首先保证缺一门，并且缺的必须是自己定缺的那一门
        // 条件：检测定缺的那一门有没有牌
        if (checkArray.filter(card => card.type === this.myQueSuit).length > 0) {
            // 定缺不满足，直接返回不能胡
            return { canHu: false, totalFan: 0, fanNames: [] };
        }

        // 验证七对子（没有副露，且手上所有的牌都是两两配对）
        if (safeFormedSets.length === 0 && checkArray.length === 14) {
            let isQiDui = true;
            for (let i = 0; i < checkArray.length; i += 2) { 
                if (i + 1 >= checkArray.length || checkArray[i].type !== checkArray[i + 1].type || checkArray[i].value !== checkArray[i + 1].value) {
                    isQiDui = false;
                    break;
                }
            }
            if (isQiDui) {
                canHu = true;
                totalFan += 2;
                fanNames.push("七对");
            }
        }

        // 七对如果没胡，验证平胡牌型（至少有一个对子，剩余牌能组成刻子或顺子）
        // 逻辑为先枚举雀头，然后看剩下的牌，是否能组成刻子或向上组成顺子。
        if (canHu === false) { 
            for (let i = 0; i < checkArray.length; i++) { 
                if (i + 1 >= checkArray.length) break;
                if (checkArray[i].type !== checkArray[i + 1].type || checkArray[i].value !== checkArray[i + 1].value) {
                    continue;
                }
                // 确定找到一个雀头，先把它从数组中剔除，再把剩下的牌推入栈中进行回溯验证
                let remainingCards = checkArray.filter((_, index) => index !== i && index !== i + 1);
                let isPingHu = this.checkMianZi(remainingCards);
                if(isPingHu){
                    canHu = true;
                    break;
                }
            }
        }

        // 开始算番逻辑
        if (canHu) { 
            // 1. 自摸 1 番
            // 条件：自摸胡牌
            // 手牌数是否为 3N + 2
            if (handCards.length % 3 === 2) {
                totalFan += 1;
                fanNames.push("自摸");
            }

            // 2. 清一色 2 番
            // 条件：totalArray 中所有牌都是同一花色
            const isClean = totalArray.every(c => c.type === totalArray[0].type);
            if (isClean) { 
                totalFan += 2;
                fanNames.push("清一色");
            }

            // 3. 金钩钓 2 番
            // 条件：钓牌是单牌（也就是胡牌的时候，手牌只有 1 或 2 张牌）
            if (handCards.length <= 2) {
                totalFan += 2;
                fanNames.push("金钩钓");
            } else {
                // 4. 碰碰胡 1 番
                // 条件：checkArray 中除了有一组是 2 张一样的外，剩下的必须全都是 3 个一样的（在金钩钓不满足的情况下）
                let hasPair = false;
                let sameCount = 1;
                let isPengPengHu = true;
                for (let i = 1; i < checkArray.length; i++) {
                    // 每张牌和前一张牌比较，如果一样就计数器加一，不一样就重置计数器
                    if (checkArray[i].type === checkArray[i - 1].type && checkArray[i].value === checkArray[i - 1].value) {
                        sameCount++;
                    } else {
                        if (sameCount !== 3 && sameCount !== 2){
                            isPengPengHu = false;
                            break;
                        } else if (sameCount === 2) {
                            if (hasPair) {
                                isPengPengHu = false;
                                break;
                            }
                            hasPair = true;
                        }
                        sameCount = 1;
                    }
                }
                if (sameCount !== 3 && sameCount !== 2){
                    isPengPengHu = false;
                } else if (sameCount === 2 && hasPair) {
                    isPengPengHu = false;
                }
                if (isPengPengHu) { 
                    totalFan += 1;
                    fanNames.push("碰碰胡");
                }
            }
            
            // 5. 根 1 番
            // 条件：totalArray 中有四张完全一样的牌（可重复计数）
            let root = 0;
            const cardCountMap: { [key: string]: number } = {};
            totalArray.forEach(c => {
                const key = `${c.type}_${c.value}`;
                cardCountMap[key] = (cardCountMap[key] || 0) + 1;
            });
            for (let key in cardCountMap) { 
                if (cardCountMap[key] >= 4) {
                    root += 1;
                }
            }
            if(root > 0){
                totalFan += root;
                fanNames.push(root + "根");
            }
        }

        return { canHu, totalFan, fanNames }; 
    }

    private checkMianZi(cards: any[]): boolean { 
        if (cards.length === 0) return true; // 所有牌都成功配对了
        if (cards.length < 3 || cards.length % 3 !== 0) return false; // 不满足基本的牌数要求
        // 强制排序
        cards = cards.sort((a, b) => {
            if (a.type !== b.type) return a.type - b.type;
            return a.value - b.value;
        });
        // 尝试取出前三张牌组成刻子
        if (cards[0].type === cards[1].type && cards[0].value === cards[1].value &&
            cards[1].type === cards[2].type && cards[1].value === cards[2].value) {
            
            if(this.checkMianZi(cards.slice(3))) {
                return true;
            }
        }
        // 取出第一张牌然后从原始数组中剔除
        let firstCard = cards.shift();
        if (firstCard.value > 7) return false; // 顺子最小牌必须不可能大于 7
        let goaltype = firstCard.type;
        let goalval1 = firstCard.value + 1;
        let goalval2 = firstCard.value + 2;
        let goalcount = 0;
        // 在剩余牌中寻找组成顺子的两张牌，目标已经定好
        for (let i = 0; i < cards.length; i++) { 
            if (goalcount === 0 && cards[i].type === goaltype && cards[i].value === goalval1) {
                // 剔除这张牌，并注意下标
                cards.splice(i, 1);
                i--;
                goalcount++;
            }
            else if (goalcount === 1 && cards[i].type === goaltype && cards[i].value === goalval2) {
                // 剔除这张牌，并注意下标
                cards.splice(i, 1);
                i--;
                goalcount++;
                break;
            }
        }

        return goalcount === 2 && this.checkMianZi(cards);
    }
}