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
    // NORMAL: 正常摸打状态 ; CHI_SELECTION: 正在选择用于吃牌的手牌
    private interactionMode: 'NORMAL' | 'CHI_SELECTION' | 'KONG_SELECTION' = 'NORMAL';
    
    // 记录上一张全场被打出的牌 (用于吃牌校验)
    private currentChiTargetCard: any = null; 
    
    // 记录在吃牌模式下，当前被弹起的节点
    // private selectedChiNode: Node | null = null;
    
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

        // 3. 清理个人牌区 (注意：中心公牌区交由增量逻辑处理，这里不再 clearTable 全清)
        this.clearPersonalTable();

        // --- 重置拦截锁逻辑 ---
        // 遍历所有玩家，只要发现有任何一个人的手牌处于 3N+2 状态，
        // 就说明当前正处于“某人的思考出牌期”，上一个拦截窗口已经彻底结束！
        let isAnyPlayerActive = false;
        const playersList = data.players || [];
        for (let p of playersList) {
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

            // 标识是否正在行动或者已经胡牌
            if (this.typeLabels[logicalIndex]) {
                const label = this.typeLabels[logicalIndex];
                if (player.isAlreadyHu) {
                    // 【最高优先级】一旦标记为已胡，强行锁定文本和颜色
                    label.string = "已胡";
                    label.color = new Color(255, 0, 0); // 可以设为醒目的红色或金色
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

            // ==========================================
            // 渲染成牌区 (碰/杠/吃的牌)
            // ==========================================
            const seatNode = this.seatNodes[logicalIndex];
            if (seatNode) {
                seatNode.removeAllChildren(); 
                
                const fixedSets = player.fixedSets || [];
                fixedSets.forEach(cardSet => {
                    // 浅拷贝数组，防止修改原始数据
                    const cards = cardSet.cards ? [...cardSet.cards] : [];
                    
                    // 严密排序：按类型和数值从小到大
                    cards.sort((a, b) => {
                        const typeA = a.type === undefined ? 0 : a.type;
                        const typeB = b.type === undefined ? 0 : b.type;
                        if (typeA !== typeB) return typeA - typeB; 
                        const valA = a.value === undefined ? 0 : a.value;
                        const valB = b.value === undefined ? 0 : b.value;
                        return valA - valB; 
                    });

                    // 动态创建内层包裹节点
                    const setContainerNode = new Node("CardSetContainer");
                    const setLayout = setContainerNode.addComponent(Layout);
                    
                    // 内层 Layout 设置为从左到右水平排列
                    setLayout.type = Layout.Type.HORIZONTAL;
                    // 必须设为 CONTAINER，包裹节点才能贴合内部卡牌的实际宽度
                    setLayout.resizeMode = Layout.ResizeMode.CONTAINER; 
                    setLayout.spacingX = 5; // 内部 3 张或 4 张牌之间的间距

                    // 将包裹节点加入到外层 SeatNode 中
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
                // 将手牌与副露数据存入全局变量，供其他方法调用
                this.myHandCardsData = player.handCards || [];
                this.myFormedSetsData = player.fixedSets || [];

                const myDiscardedHistory = player.discardedCards || [];

                // 清空旧的手牌节点
                if (this.handArea) {
                    this.handArea.removeAllChildren(); 
                }

                const handCards = this.myHandCardsData; 
                let sortedCards: any[] = [];
                let newDrawnCard: any = null;

                // 剥离刚摸到的牌 (适配副露后的 11, 8, 5 张状态)
                if (handCards.length % 3 === 2) {
                    newDrawnCard = handCards[handCards.length - 1]; 
                    sortedCards = handCards.slice(0, handCards.length - 1);           
                } else {
                    sortedCards = [...handCards];
                }

                // 严格双重排序 (类型 -> 数值)
                sortedCards.sort((a, b) => {
                    const typeA = a.type === undefined ? 0 : a.type;
                    const typeB = b.type === undefined ? 0 : b.type;
                    if (typeA !== typeB) return typeA - typeB; 
                    const valA = a.value === undefined ? 0 : a.value;
                    const valB = b.value === undefined ? 0 : b.value;
                    return valA - valB; 
                });

                // 渲染基础手牌
                sortedCards.forEach(cardData => {
                    const cardNode = instantiate(this.cardPrefab);
                    this.handArea.addChild(cardNode);
                    cardNode.on(Node.EventType.TOUCH_END, this.onHandCardClick, this);
                    this.updateCardUI(cardNode, true, cardData); 
                });

                // 渲染新摸到的高亮牌
                if (newDrawnCard) {
                    const cardNode = instantiate(this.cardPrefab);
                    this.handArea.addChild(cardNode);
                    cardNode.on(Node.EventType.TOUCH_END, this.onHandCardClick, this);
                    this.updateCardUI(cardNode, true, newDrawnCard, true); 
                }

                // 取出我自己的状态数据
                const myData = data.players.find(p => p.seatIndex === this.myServerSeat);
                const amIAlreadyHu = myData ? myData.isAlreadyHu : false;

                // 【核心屏障】如果我已经胡了，彻底变成一个看客，绝对不亮起任何交互按钮！
                if (amIAlreadyHu) {
                    log("【系统】我已胡牌，屏蔽所有本地状态判定！");
                    this.resetActionButtons(); // 强制熄灭所有按钮
                    // 这里不需要偷偷发 PASS，因为后端的 waitCount 压根就没有算我！
                    return; 
                }

                // ==========================================
                // 拦截与动作判定通道
                // ==========================================
                const lastDiscard = data.lastDiscardedCard; 
                this.currentChiTargetCard = lastDiscard;
                const remain = data.remainingCardsCount === undefined ? 0 : data.remainingCardsCount;

                // 场景 A：我的回合 (手牌数为 3N+2) - 自摸、暗杠、补杠
                if (this.currentActionSeat === this.myServerSeat && handCards.length % 3 === 2) {
                    if (!this.isAfterChiPong) {
                        log("【系统】我的回合，执行自摸与主动判定...");
                        
                        // 1. 自摸检测
                        const huResult = this.checkCanHu(handCards, null, this.myFormedSetsData); 
                        if (huResult && huResult.canHu) { 
                            this.currentTotalFan = huResult.totalFan === undefined ? 0 : huResult.totalFan;
                            this.currentFanNames = huResult.fanNames || [];
                            log(`【系统】自摸判定通过！番数: ${this.currentTotalFan}`);
                            
                            this.setActionButtonState(this.btnHu, true, 250, 33, 33); 
                            this.setActionButtonState(this.btnPass, true, 255, 255, 255);
                        }

                        // 2. 主动杠牌检测 (暗杠或补杠，传入刚刚赋值好的 myFormedSetsData)
                        if (remain > 0 && this.checkCanAnOrBuKong(handCards, this.myFormedSetsData)) {
                            log("【系统】暗杠/补杠判定通过！");
                            this.setActionButtonState(this.btnKong, true, 252, 222, 69); 
                            this.setActionButtonState(this.btnPass, true, 255, 255, 255);
                        }
                    }
                }
                
                // 场景 B：别人的回合 (手牌数为 3N+1) - 点炮、明杠、碰
                // TODO: 自己不能交互自己打出的牌
                else if (this.currentActionSeat !== this.myServerSeat && handCards.length % 3 === 1 && lastDiscard && !isAnyPlayerActive) {
                    log("【系统】他人回合，执行外部拦截判定...");

                    let hasAnyAction = false;
                    
                    // 1. 点炮检测
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
                        // 2. 明杠检测
                        if (this.checkCanMingKong(handCards, lastDiscard)) {
                            log("【系统】明杠判定通过！");
                            this.setActionButtonState(this.btnKong, true, 252, 222, 69);
                            this.setActionButtonState(this.btnPass, true, 255, 255, 255);
                            hasAnyAction = true;
                        }

                        // 3. 碰牌检测
                        if (this.checkCanPong(handCards, lastDiscard)) {
                            log("【系统】碰牌判定通过！");
                            this.setActionButtonState(this.btnPong, true, 36, 141, 255); 
                            this.setActionButtonState(this.btnPass, true, 255, 255, 255);
                            hasAnyAction = true;
                        }
                    } else {
                        log("【系统】牌山已空，关闭吃/碰/杠物理通道，仅保留胡牌判定。");
                    }

                    if (!hasAnyAction) {
                        // 只有在锁是打开的状态下，才发送自动过牌
                        if (!this.isInterceptLockActive) {
                            log("【系统】无任何可拦截操作，前端自动发送“过”放行状态机...");
                            
                            // 瞬间上锁！在这个拦截窗口彻底结束前，绝对不发第二次 PASS
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

        // 判定 1：新局开始，后端记录为空，前端立刻清场
        if (historyDiscards.length === 0 && this.centerArea) {
            this.centerArea.removeAllChildren();
        } 
        // 判定 2：正常推进，追加渲染新增的弃牌（节约性能，保留已有节点的动画）
        else if (historyDiscards.length > currentUINodesCount) {
            for (let i = currentUINodesCount; i < historyDiscards.length; i++) {
                this.appendDiscardedCard(historyDiscards[i]);
            }
        }
        // 判定 3：极端异常（如重连后发现本地弃牌数量多于服务端），全量重绘
        else if (historyDiscards.length < currentUINodesCount) {
            if (this.centerArea) this.centerArea.removeAllChildren();
            historyDiscards.forEach(card => this.appendDiscardedCard(card));
        }

        this.highlightLastDiscard();

        // 6. 自动摸牌逻辑
        // if (isMyTurn && this.netManager) {
        //     const myPlayer = data.players.find(p => {
        //         const sIndex = p.seatIndex === undefined ? 0 : p.seatIndex;
        //         return sIndex === this.myServerSeat;
        //     });
        //     const myHandCards = myPlayer?.handCards || [];
            
        //     log(`【系统】当前手牌数量: ${myHandCards.length}`);
            
        //     // 使用麻将 3N+1 摸牌定律
        //     if (myHandCards.length > 0 && myHandCards.length % 3 === 1) {
        //         log("【系统】手牌数量符合 3N+1，向服务器申请摸牌 (DRAW)...");
        //         this.netManager.sendPlayerAction(ActionType.DRAW);
        //     }
        // }
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

        // 1. 数据收集阶段：使用 Map 统计手中每张牌的数量
        // Key 格式为 "type_value" (例如万子3就是 "1_3")，Value 为数量
        const cardCountMap = new Map<string, number>();

        for (let c of handCards) {
            const cType = c.type === undefined ? 0 : c.type;
            const cVal = c.value === undefined ? 0 : c.value;
            const key = `${cType}_${cVal}`;
            
            const currentCount = cardCountMap.get(key) || 0;
            cardCountMap.set(key, currentCount + 1);
        }

        // 2. 逻辑判定阶段：遍历统计好的字典
        for (let [key, count] of cardCountMap.entries()) {
            
            // 场景 A：暗杠判定
            // 只要某种牌在手里达到了 4 张，立刻触发短路返回
            if (count === 4) {
                return true;
            }

            // 场景 B：补杠判定
            // 如果手中有这张牌 (count >= 1)，我们需要去副露区寻找是否碰过它
            if (count >= 1 && formedSets && formedSets.length > 0) {
                // 解析出当前这张牌的真实 type 和 value
                const parts = key.split('_');
                const cType = parseInt(parts[0], 10);
                const cVal = parseInt(parts[1], 10);

                for (let set of formedSets) {
                    if (!set.cards || set.cards.length === 0) continue;
                    const setType = set.type === undefined ? ActionType.DRAW : set.type;
                    
                    if (setType === ActionType.PONG && set.cards && set.cards.length > 0) {
                        const setCardType = set.cards[0].type === undefined ? 0 : set.cards[0].type;
                        const setCardVal = set.cards[0].value === undefined ? 0 : set.cards[0].value;
                        
                        // 碰牌的花色和数值与手中的这张牌完全一致
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
     * 检查是否可以吃牌 (上家打出牌时调用)
     * @param handCards 玩家当前的暗手牌数组
     * @param targetCard 上家刚打出的那张牌
     * @returns boolean
     */
    private checkCanChi(handCards: any[], targetCard: any): boolean {
        // 安全拦截：如果手牌为空或目标牌不存在，直接返回 false
        if (!handCards || !targetCard) return false;

        const tType = targetCard.type === undefined ? 0 : targetCard.type;
        const tVal = targetCard.value === undefined ? 0 : targetCard.value;

        if (tType === 4) return false;

        // 1. 使用 Set 提取并去重同花色的牌值
        const availableVals = new Set<number>();

        for (let c of handCards) {
            const cType = c.type === undefined ? 0 : c.type;
            const cVal = c.value === undefined ? 0 : c.value;
            
            // 只有同花色的牌才有资格参与“吃”的判定
            if (cType === tType) {
                availableVals.add(cVal);
            }
        }

        // 2. 利用 Set 的 O(1) 查询效率进行验证
        // 只要下面三种组合中的任意一种成立，立刻短路返回 true

        // 组合 1：存在 [目标-2] 和 [目标-1]
        if (availableVals.has(tVal - 2) && availableVals.has(tVal - 1)) {
            return true;
        }

        // 组合 2：存在 [目标-1] 和 [目标+1]
        if (availableVals.has(tVal - 1) && availableVals.has(tVal + 1)) {
            return true;
        }

        // 组合 3：存在 [目标+1] 和 [目标+2]
        if (availableVals.has(tVal + 1) && availableVals.has(tVal + 2)) {
            return true;
        }

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
            // 拦截吃牌选择
            if (this.interactionMode === 'CHI_SELECTION') {
                this.handleChiCardSelection(cardUI);
                return; // 拦截成功，绝对不执行下方的正常出牌逻辑
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
                    
                    if (this.netManager) {
                        this.netManager.sendPlayerAction(ActionType.DISCARD, cardInfo);
                    }
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
     * 处理吃牌模式下的二次点击与算数校验
     */
    private handleChiCardSelection(cardUI: any) {
        // 1. 如果点的是另一张牌，把之前弹起的牌放下去
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

        // 3. 第二次点击同一张牌：确认吃牌！执行严密的算数校验
        const D = this.currentChiTargetCard; 
        if (!D) {
            log("【系统-Error】吃牌确认失败：找不到 currentChiTargetCard，请检查数据同步！");
            this.cancelSelectionMode();
            return;
        }
        
        // 严防 undefined
        const dType = D.type === undefined ? 0 : D.type;
        const dVal = D.value === undefined ? 0 : D.value;
        const sType = cardUI.type === undefined ? 0 : cardUI.type;
        const sVal = cardUI.value === undefined ? 0 : cardUI.value;

        // 花色校验
        if (dType !== sType) {
            log("【系统】吃牌失败：必须使用同花色的牌！");
            this.cancelSelectionMode();
            return;
        }

        // 算数分发逻辑 (找第二张牌)
        let requiredSecondValue = -1;
        
        if (sVal === dVal - 2) {
            requiredSecondValue = dVal - 1; // 选 2，目标 4，找 3
        } else if (sVal === dVal - 1) {
            requiredSecondValue = dVal + 1; // 选 3，目标 4，找 5
        } else if (sVal === dVal + 1) {
            requiredSecondValue = dVal + 2; // 选 5，目标 4，找 6
        } else {
            log("【系统】吃牌失败：该牌无法作为手牌中能吃的最小牌！");
            this.cancelSelectionMode();
            return;
        }

        // 遍历真实手牌数据，检查存不存在这第二张牌
        let hasSecondCard = false;
        for (let c of this.myHandCardsData) {
            const cType = c.type === undefined ? 0 : c.type;
            const cVal = c.value === undefined ? 0 : c.value;
            if (cType === sType && cVal === requiredSecondValue) {
                hasSecondCard = true;
                break;
            }
        }
        
        if (hasSecondCard) {
            log(`【系统】验证通过！使用 ${sVal} 和 ${requiredSecondValue} 组合吃牌！`);
            
            const actionData = {
                chiCards: [
                    { type: sType, value: sVal },
                    { type: sType, value: requiredSecondValue }
                ]
            };
            
            if (this.netManager) {
                this.isAfterChiPong = true;
                this.netManager.sendPlayerAction(ActionType.CHI, actionData);
            }
            
            this.resetActionButtons();
            this.cancelSelectionMode(); 
            
        } else {
            log(`【系统】吃牌失败：手里缺少配对的牌 ${requiredSecondValue}！`);
            this.cancelSelectionMode();
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

    /** 绑定到“吃”按钮 (不发送网络请求，而是切换 UI 状态) */
    public onBtnAction_Chi() {
        log("【交互】进入吃牌模式！请点击手牌中用于吃牌最小的牌...");
        this.interactionMode = 'CHI_SELECTION';
        if (this.turnStatusLabel) {
            this.turnStatusLabel.string = "吃牌（选最小）";
            this.turnStatusLabel.color = new Color(124, 36, 255); // 和吃按钮同色的提示
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

    // “过”按钮的核心逻辑：发送过牌指令（如果当前有碰/杠/胡资格），或者仅重置 UI 状态（如果处于吃牌选择模式）
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
        if (!summary) return;

        // 1. 生成底层：全局分数变动大面板 (ROUND_SCORES)
        const sortedScores = summary.scores ? [...summary.scores] : [];
        sortedScores.sort((a, b) => {
            const scoreA = a.scoreChange === undefined ? 0 : a.scoreChange;
            const scoreB = b.scoreChange === undefined ? 0 : b.scoreChange;
            return scoreB - scoreA; 
        });
        
        this.showResultPanel('ROUND_SCORES', sortedScores, null);

        // 2. 生成顶层：如果是胡牌结束，依次弹出每个胡牌玩家的详情面板 (WINNER_DETAIL)
        // 注意：如果你后端的协议已经改成了 repeated WinnerDetail winners = 1;
        if (summary.winners && summary.winners.length > 0) {
            summary.winners.forEach((winnerInfo) => {
                this.showResultPanel('WINNER_DETAIL', [], winnerInfo);
            });
        }
        // 如果是流局（winners 为空），则上面不会执行，只剩下底层的计分板，逻辑完美闭环。
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

        const leaderboardNode = panelNode.getChildByName("Leaderboard");
        if (!leaderboardNode) return;

        // 获取所需组件
        const titleLabel = leaderboardNode.getChildByName("Title")?.getComponent(Label);
        const scrollView = panelNode.getComponentInChildren(ScrollView);
        const cardsArea = leaderboardNode.getChildByName("WinningCardsArea");
        const confirmBtnNode = leaderboardNode.getChildByName("ConfirmButton");
        const btnLabel = confirmBtnNode?.getComponentInChildren(Label);

        // ==========================================
        // 1. 标题与排版控制
        // ==========================================
        if (titleLabel) {
            if (renderType === 'WINNER_DETAIL' && detailData) {
                const fanStr = (detailData.fanNames && detailData.fanNames.length > 0) ? detailData.fanNames.join(" + ") : "平胡";
                const tFan = detailData.totalFan === undefined ? 0 : detailData.totalFan;
                titleLabel.string = `座位 ${detailData.seatIndex} 胡牌详情: ${fanStr} (${tFan}番)`;
            } else if (renderType === 'ROUND_SCORES') {
                titleLabel.string = "本局分数结算";
            } else if (renderType === 'FINAL') {
                titleLabel.string = typeof detailData === 'string' ? detailData : "游戏结束：最终排名";
            }
        }

        // ==========================================
        // 2. 渲染排行榜分数 (仅对 FINAL 和 ROUND_SCORES 开启)
        // ==========================================
        if (scrollView) {
            scrollView.node.active = (renderType !== 'WINNER_DETAIL'); // 胡牌详情页隐藏滑动列表
            
            if (scrollView.node.active) {
                const content = scrollView.content;
                if (content) {
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
            }
        }

        // ==========================================
        // 3. 渲染赢家的牌型结构 (仅对 WINNER_DETAIL 开启)
        // ==========================================
        if (cardsArea) {
            cardsArea.active = (renderType === 'WINNER_DETAIL'); // 分数排行页隐藏牌型区
            
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
            // 根据不同形态动态修改按钮文字
            if (btnLabel) {
                if (renderType === 'WINNER_DETAIL') btnLabel.string = "关闭详情";
                else if (renderType === 'ROUND_SCORES') btnLabel.string = "准备下一局";
                else btnLabel.string = "返回大厅";
            }

            confirmBtnNode.on(Button.EventType.CLICK, () => {
                if (renderType === 'ROUND_SCORES' && this.netManager) {
                    // 只有最底层的计分板被点击时，才会发送 1009 准备协议
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
                
                // WINNER_DETAIL 形态下点击只会销毁自己，露出下面的面板
                panelNode.destroy();
            }, this);
        }
    }

    // --- 视觉与数据转换辅助 ---

    private updateCardUI(cardNode: Node, isFaceUp: boolean, info: any, isNewlyDrawn: boolean = false) {
        // 1. 基础信息赋值
        const cardUI = cardNode.getComponent(CardUI); // 假设你有一个挂载的脚本用于存数据
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

        // 如果是暗牌，后面的正面渲染逻辑直接跳过，节约性能
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
            
            // 【核心修改】直接从我们的内存字典里拿图片！
            const frame = this.tileCache.get(spriteName);
            
            if (frame && faceSprite) {
                faceSprite.spriteFrame = frame;
                hasTexture = true;
            }
        }

        // 贴图加载成功：显示贴图，隐藏文字，防止透明区穿模
        if (faceNode) faceNode.active = hasTexture;
        
        if (labelNode && label) {
            labelNode.active = !hasTexture; // 贴图失败或没配置时，才显示文字
            
            if (!hasTexture) {
                label.string = this.getMahjongCardStr(info.type, info.value);
                const colors = [Color.WHITE, new Color(220, 20, 60), new Color(30, 144, 255), new Color(34, 139, 34), Color.BLACK];
                label.color = colors[info.type] || Color.BLACK;
            }
        }

        // 6. 统一高亮着色逻辑：新摸的牌，底板和花色必须一起变黄
        const tintColor = isNewlyDrawn ? new Color(255, 255, 150) : Color.WHITE;
        if (bgSprite) {
            bgSprite.color = tintColor;
        }
        if (faceSprite) {
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

        // 首先保证缺一门
        // 条件：totalArray 中花色恰好只有 2 种
        const suitSet = new Set<number>();
        totalArray.forEach(c => {
            if (c.type >= 1 && c.type <= 3) {
                suitSet.add(c.type);
            }
        });
        if (suitSet.size > 2) { // 不满足缺一门条件，直接返回不能胡
            log("【胡牌检测】不满足缺一门条件");
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
            } else{
                // 4. 碰碰胡 1 番
                // 条件：checkArray 中除了有一组是 2 张一样的外，剩下的必须全都是 3 个一样的（在金钩钓不满足的情况下）
                let hasPair = false;
                let sameCount = 1;
                let isPengPengHu = true;
                for (let i = 1; i < checkArray.length; ) {
                    // 每张牌和前一张牌比较，如果一样就计数器加一，不一样就重置计数器
                    if (checkArray[i].type === checkArray[i - 1].type && checkArray[i].value === checkArray[i - 1].value) {
                        sameCount++;
                        i++;
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
                    totalFan += 1;
                    root += 1;
                    break;
                }
            }
            if(root > 0){
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