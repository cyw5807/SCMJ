package com.example.handler;

import java.util.*;

import msg.GameMessage;
import msg.GameMessage.*;

import com.example.model.PendingAction;
import com.example.model.Player;

/**
 * 游戏逻辑控制器
 * 职责：维护麻将牌池唯一性，控制回合流转、动作校验与数值结算
 */
public class GameController {
    private int currentActionSeat = 0;  // 记录当前行动的座位号
    private List<CardInfo> deck; 
    private CardInfo lastDiscardedCard; // 记录最后一张被打出的牌，用于判定碰杠胡
    private int lastDiscarderSeat = -1; // 记录最后打出牌的人，用于点炮追责
    private List<CardInfo> globalDiscardedCards = new ArrayList<>();
    
    private int maxMatches = 99;           // 总局数上限
    private int currentMatchCount = 0;     // 当前已完成或正在进行的局数
    private int currentDealerSeat = 0;     // 当前局的庄家座位号
    
    private Set<String> readyPlayers = new HashSet<>();

    private ActionStateMachine stateMachine = new ActionStateMachine();

    private List<msg.GameMessage.WinnerDetail> currentRoundWinners = new ArrayList<>(); // 暂存本局所有胡牌玩家的详情

    /**
     * 整场游戏初始化（仅在房主点击开始时调用一次）
     */
    public void initGameSession(List<String> playerCids) {
        this.currentMatchCount = 0;
        this.currentDealerSeat = 0; // 默认座位 0 首局当庄
        
        for (String cid : playerCids) {
            Player p = MsgDispatcher.onlinePlayers.get(cid);
            if (p != null) p.resetSession();
        }
    }

    /**
     * 单局初始化（每打完一盘调用一次）
     */
    public void startNewMatch(List<String> playerCids) {
        this.currentMatchCount++;
        // 使用 Dealer 类创建去掉风、字牌的麻将牌堆
        this.deck = Dealer.createMahjongDeck();
        Collections.shuffle(this.deck);
        this.lastDiscardedCard = null;
        this.lastDiscarderSeat = -1;
        this.globalDiscardedCards.clear();
        
        // 开局行动者为本局庄家
        this.currentActionSeat = this.currentDealerSeat;

        // 清理玩家上一局的临时数据，保留总分
        for (String cid : playerCids) {
            Player p = MsgDispatcher.onlinePlayers.get(cid);
            if (p != null) p.clearMatchData();
        }

        this.currentRoundWinners.clear();

        System.out.println("【游戏控制】第 " + currentMatchCount + "/" + maxMatches + " 局开始，庄家座位：" + currentDealerSeat);
    }

    /**
     * 判定整场游戏是否全部结束
     */
    public boolean isGameSessionOver() {
        return currentMatchCount >= maxMatches;
    }

    /**
     * 单局结束时的庄家轮换逻辑
     * @param winnerSeat 本局胡牌的赢家（如果是流局传 -1）
     * @param totalPlayers 房间总人数
     */
    public void finishCurrentMatch(int winnerSeat, int totalPlayers) {
        // 严谨的数值安全兜底：防范传入异常人数（如 0 或负数），默认保底为 4
        int safeTotalPlayers = totalPlayers > 0 ? totalPlayers : 4;

        // 如果不是庄家胡牌或者流局，庄家位下移
        if (winnerSeat != currentDealerSeat) {
            currentDealerSeat = (currentDealerSeat + 1) % safeTotalPlayers;
        }
    }

    /**
     * 标记玩家已准备好进入下一局
     */
    public void playerReadyForNextMatch(String cid) {
        this.readyPlayers.add(cid);
    }

    /**
     * 检查是否所有玩家都已准备完毕
     */
    public boolean isAllReadyForNextMatch(int roomSize) {
        return this.readyPlayers.size() >= roomSize;
    }

    /**
     * 清理准备状态，用于新一局发牌前
     */
    public void clearReadyState() {
        this.readyPlayers.clear();
    }

    /**
     * 构建单局小结数据包 (RoundSummary) - 用于【流局/荒庄】
     */
    public msg.GameMessage.RoundSummary buildRoundSummary(int winnerSeat, String winType, List<String> playerCids, Map<String, Player> onlinePlayers) {
        msg.GameMessage.RoundSummary.Builder builder = msg.GameMessage.RoundSummary.newBuilder();
        
        // 注意：协议里已经没有 setWinnerSeat 和 setWinType 了！
        // 流局时，winners 列表保持为空即可，前端会自动识别为流局

        for (String cid : playerCids) {
            Player p = onlinePlayers.get(cid);
            if (p != null) {
                // 读取单局累加器中的净胜分 (流局通常是 0)
                int scoreChange = p.getRoundScoreDelta(); 
                
                builder.addScores(msg.GameMessage.PlayerRoundScore.newBuilder()
                        .setSeatIndex(p.getSeatIndex())
                        .setNickname(p.getNickname() == null ? "未知玩家" : p.getNickname())
                        .setScoreChange(scoreChange)
                        .setCurrentTotalScore(p.getScore())
                        .build());
            }
        }

        // 触发轮庄
        int safePlayerCount = (playerCids == null || playerCids.isEmpty()) ? 4 : playerCids.size();
        finishCurrentMatch(winnerSeat, safePlayerCount);

        return builder.build();
    }

    /**
     * 出牌后的状态流转逻辑 (对接状态机)
     */
    public void handleDiscardAction(int seatIndex, CardInfo card, int totalPlayers, Map<String, Player> onlinePlayers) {
        // 1. 记录物理出牌数据
        this.lastDiscardedCard = card;
        this.lastDiscarderSeat = seatIndex; 
        this.globalDiscardedCards.add(card);
        
        // 2. 【核心修复】：只遍历当前房间的真实存活玩家
        int waitCount = 0;
        for (String cid : MsgDispatcher.roomPlayers) {
            Player p = onlinePlayers.get(cid);
            if (p != null && p.getSeatIndex() != seatIndex && !p.isAlreadyHu()) {
                waitCount++;
            }
        }
        
        // 3. 将控制权交给状态机
        if (waitCount > 0) {
            System.out.println("【状态机】开启拦截窗口，等待 " + waitCount + " 名未胡玩家响应...");
            this.stateMachine.startInterceptWindow(waitCount, this.lastDiscarderSeat, totalPlayers);
        } else {
            System.out.println("【状态机】无需等待任何玩家，直接顺延...");
            int nextSeat = getNextActiveSeat(seatIndex, MsgDispatcher.roomPlayers);
            this.currentActionSeat = nextSeat;
            this.lastDiscardedCard = null; // 清理浮空牌
        }
    }

    /**
     * 接收拦截动作，并在收集完毕后执行最终结果
     */
    public synchronized boolean receiveInterceptAction(int seatIndex, int actionCode, int totalFan, List<String> fanNames, List<CardInfo> extraCards, Map<String, Player> onlinePlayers, List<String> roomPlayers) {
        
        // 【核心护盾】防御重复包与非法渗透
        if (!this.stateMachine.isIntercepting()) {
            System.out.println("【系统护盾】当前不在拦截等待状态，已丢弃玩家 " + seatIndex + " 的迟到/非法动作: " + actionCode);
            return false; // 瞬间拔掉网线，绝对不往下执行任何结算与发牌逻辑！
        }

        // 【核心护盾】绝对禁止“已经胡牌的玩家”和“打出这张牌的本主”向状态机发送任何指令（包括前端自动发来的 PASS）
        Player sender = getPlayerBySeat(seatIndex, onlinePlayers, roomPlayers);
        if (sender == null || sender.isAlreadyHu() || seatIndex == this.lastDiscarderSeat) {
            System.out.println("【系统护盾】已成功拦截幽灵包！丢弃玩家 " + seatIndex + " (已胡/出牌本主) 的无效拦截指令。");
            return false; // 直接丢弃，绝对不让它计入状态机的收集总数！
        }

        // 1. 把动作丢给状态机记录
        this.stateMachine.receiveAction(seatIndex, actionCode, totalFan, fanNames, extraCards);

        // 2. 检查状态机是否已经收集完毕并关闭了窗口
        if (!this.stateMachine.isIntercepting()) {
            System.out.println("【状态机裁决】由玩家 " + seatIndex + " 的操作完成了最终收集！开始执行优先级比较...");

            // 3. 拿取最终胜出的动作 (支持一炮多响的列表)
            List<PendingAction> finalActions = this.stateMachine.resolveMultipleActions();

            if (finalActions.isEmpty()) {
                // ==========================================
                // 场景 A：所有人都点了“过” (或无人可拦截)
                // ==========================================
                
                // 使用专门的寻座器，自动跳过已经胡牌的玩家！
                int nextSeat = getNextActiveSeat(this.lastDiscarderSeat, roomPlayers);
                this.currentActionSeat = nextSeat;
                
                System.out.println("【游戏流转】无人拦截，回合顺延至存活的下家: 座位 " + this.currentActionSeat);
                
                // 下家自动摸一张牌
                Player nextPlayer = getPlayerBySeat(this.currentActionSeat, onlinePlayers, roomPlayers);
                if (nextPlayer != null) {
                    CardInfo newDrawnCard = drawOneCard(); 
                    
                    if (newDrawnCard != null) {
                        nextPlayer.getHandCards().add(newDrawnCard);
                    } else {
                        System.out.println("【全局结算】牌堆已完全抽空，游戏彻底结束！");
                        broadcastRoundEnd(onlinePlayers, roomPlayers);
                        this.lastDiscardedCard = null;
                        this.stateMachine.resetMachine();
                        return false; 
                    }
                }
            } 
            else if (finalActions.get(0).actionCode == 4) {
                // ==========================================
                // 场景 B：触发胡牌 (一炮多响并发处理)
                // ==========================================
                System.out.println("【游戏流转】触发胡牌结算！胡牌人数: " + finalActions.size());
                
                // 【核心修复】：找到“最后一个胡牌的人”（离出牌者座位距离最远的人）
                int lastWinnerSeat = -1;
                int maxDistance = -1;
                
                // 1. 遍历所有的胡牌动作，逐一进行算分和生成战报
                for (PendingAction huAct : finalActions) {
                    msg.GameMessage.WinnerDetail detail = processHu(
                            huAct.seatIndex, onlinePlayers, roomPlayers, huAct.totalFan, huAct.fanNames
                    );
                    if (detail != null) {
                        this.currentRoundWinners.add(detail);
                    }

                    // 计算座位距离公式：(胡牌者座位 - 点炮者座位 + 总人数) % 总人数
                    int distance = (huAct.seatIndex - this.lastDiscarderSeat + roomPlayers.size()) % roomPlayers.size();
                    if (distance > maxDistance) {
                        maxDistance = distance;
                        lastWinnerSeat = huAct.seatIndex; // 不断更新，直到找到离点炮者最远的那个胡牌者
                    }
                }

                // 2. 存活人数检测 (大逃杀终局阈值)
                int activeCount = 0;
                for (Player p : onlinePlayers.values()) {
                    if (!p.isAlreadyHu()) activeCount++;
                }

                if (activeCount <= 1) {
                    System.out.println("【全局结算】场上仅剩1名存活玩家，游戏彻底结束！");
                    broadcastRoundEnd(onlinePlayers, roomPlayers);
                    this.lastDiscardedCard = null;
                    this.stateMachine.resetMachine();
                    return false; 
                }

                // 3. 【核心修复】：游戏继续，从“最后一个胡牌玩家”开始顺延游标！
                System.out.println("【游戏流转】最后一个胡牌者为: 座位 " + lastWinnerSeat + "，开始寻找下一位存活玩家...");
                int nextSeat = getNextActiveSeat(lastWinnerSeat, roomPlayers);
                this.currentActionSeat = nextSeat;
                System.out.println("【游戏流转】回合已移交至: 座位 " + this.currentActionSeat);
                
                Player nextPlayer = getPlayerBySeat(nextSeat, onlinePlayers, roomPlayers);
                CardInfo newCard = drawOneCard();
                
                if (newCard != null) {
                    nextPlayer.getHandCards().add(newCard);
                } else {
                    System.out.println("【全局结算】牌山已空，游戏彻底结束！");
                    broadcastRoundEnd(onlinePlayers, roomPlayers);
                    this.lastDiscardedCard = null;
                    this.stateMachine.resetMachine();
                    return false;
                }
                
                // 不清除 globalDiscardedCards 中的牌，使其留在点炮者的牌河中
            }
            else {
                // ==========================================
                // 场景 C：碰 / 杠 (被降维打击后剩下的唯一操作)
                // ==========================================
                PendingAction singleAct = finalActions.get(0);
                int winnerSeat = Math.max(0, singleAct.seatIndex);
                int actCode = Math.max(0, singleAct.actionCode);
                
                this.currentActionSeat = winnerSeat;
                Player interceptor = getPlayerBySeat(winnerSeat, onlinePlayers, roomPlayers);

                if (actCode == 2 && interceptor != null) { 
                    // --- 碰牌 (PONG) ---
                    System.out.println("【游戏流转】玩家 " + winnerSeat + " 执行碰牌！");
                    
                    // 第 1 步：将刚才打出的牌从公共牌池 (牌河) 中没收
                    if (this.globalDiscardedCards != null && !this.globalDiscardedCards.isEmpty()) {
                        this.globalDiscardedCards.remove(this.globalDiscardedCards.size() - 1);
                    }
                    
                    // 第 2 步：从拦截者的手牌中扣除 2 张相同类型的牌
                    if (interceptor.getHandCards() != null && this.lastDiscardedCard != null) {
                        int removeCount = 0;
                        java.util.Iterator<CardInfo> iterator = interceptor.getHandCards().iterator();
                        while (iterator.hasNext()) {
                            CardInfo c = iterator.next();
                            int type1 = c.getType();
                            int val1 = c.getValue();
                            int type2 = this.lastDiscardedCard.getType();
                            int val2 = this.lastDiscardedCard.getValue();
                            
                            if (type1 == type2 && val1 == val2) {
                                iterator.remove();
                                removeCount++;
                                if (removeCount == 2) break;
                            }
                        }
                    }
                    
                    // 第 3 步：组装一个“成牌组合 (CardSet)”
                    if (this.lastDiscardedCard != null) {
                        msg.GameMessage.CardSet pongSet = msg.GameMessage.CardSet.newBuilder()
                                .setType(msg.GameMessage.ActionType.PONG) 
                                .addCards(this.lastDiscardedCard) 
                                .addCards(this.lastDiscardedCard) 
                                .addCards(this.lastDiscardedCard) 
                                .build();
                        
                        if (interceptor.getFormedSets() != null) {
                            interceptor.getFormedSets().add(pongSet);
                        }
                    }
                    sortCards(interceptor.getHandCards());
                }
                else if (actCode == 3 && interceptor != null) { 
                    // --- 明杠 (KONG) ---
                    System.out.println("【游戏流转】玩家 " + winnerSeat + " 执行明杠！");

                    // 【明杠收分逻辑】
                    Player kongPlayer = getPlayerBySeat(winnerSeat, onlinePlayers, roomPlayers);
                    Player discarder = getPlayerBySeat(this.lastDiscarderSeat, onlinePlayers, roomPlayers);
                    
                    if (kongPlayer != null && discarder != null) {
                        discarder.modifyScore(-2);
                        kongPlayer.modifyScore(2);
                    }
                    
                    // 第 1 步：将刚才打出的牌从公共牌池 (牌河) 中没收
                    if (this.globalDiscardedCards != null && !this.globalDiscardedCards.isEmpty()) {
                        this.globalDiscardedCards.remove(this.globalDiscardedCards.size() - 1);
                    }
                    
                    // 第 2 步：从拦截者的手牌中扣除 3 张相同类型的牌
                    if (interceptor.getHandCards() != null && this.lastDiscardedCard != null) {
                        int removeCount = 0;
                        java.util.Iterator<CardInfo> iterator = interceptor.getHandCards().iterator();
                        while (iterator.hasNext()) {
                            CardInfo c = iterator.next();
                            int type1 = Math.max(0, c.getType());
                            int val1 = Math.max(0, c.getValue());
                            int type2 = Math.max(0, this.lastDiscardedCard.getType());
                            int val2 = Math.max(0, this.lastDiscardedCard.getValue());
                            
                            if (type1 == type2 && val1 == val2) {
                                iterator.remove();
                                removeCount++;
                                if (removeCount == 3) break; 
                            }
                        }
                    }
                    
                    // 第 3 步：组装成牌组合 (4张牌)
                    if (this.lastDiscardedCard != null) {
                        msg.GameMessage.CardSet kongSet = msg.GameMessage.CardSet.newBuilder()
                                .setType(msg.GameMessage.ActionType.KONG)
                                .addCards(this.lastDiscardedCard)
                                .addCards(this.lastDiscardedCard)
                                .addCards(this.lastDiscardedCard)
                                .addCards(this.lastDiscardedCard)
                                .build();
                        
                        if (interceptor.getFormedSets() != null) {
                            interceptor.getFormedSets().add(kongSet);
                        }
                    }
                    sortCards(interceptor.getHandCards());
                    
                    // 第 4 步：杠牌补牌
                    CardInfo replacementCard = drawOneCard();
                    if (replacementCard != null && interceptor.getHandCards() != null) {
                        interceptor.getHandCards().add(replacementCard);
                    }
                    System.out.println("【游戏流转】杠牌完成，已发放补牌。");
                } 
            }

            // ==========================================
            // 最终收尾逻辑 (所有分支共享)
            // ==========================================
            this.lastDiscardedCard = null;
            this.stateMachine.resetMachine();

            return true;
        }

        // 还没收集满，当前线程的使命结束，返回 false
        return false;
    }

    /**
     * 寻找下一个未胡牌的存活玩家
     */
    public int getNextActiveSeat(int currentSeat, List<String> roomPlayers) {
        int total = roomPlayers.size();
        for (int i = 1; i <= total; i++) {
            int next = (currentSeat + i) % total;
            Player p = getPlayerBySeat(next, MsgDispatcher.onlinePlayers, roomPlayers);
            if (p != null && !p.isAlreadyHu()) {
                return next;
            }
        }
        return currentSeat; 
    }

    /**
     * 处理单次胡牌的数值结算逻辑 (支持血战到底)
     */
    public WinnerDetail processHu(int winnerSeat, Map<String, Player> onlinePlayers, List<String> roomPlayers, int totalFan, List<String> fanNames) {
        Player winner = getPlayerBySeat(winnerSeat, onlinePlayers, roomPlayers);
        if (winner == null) return null;

        // 标记为已胡，退出后续的战斗流转
        winner.setAlreadyHu(true);

        boolean isZimo = (winner.getHandCards().size() % 3 == 2); 
        String winType = isZimo ? "自摸" : "点炮";
        int safeTotalFan = Math.max(0, totalFan);

        // 1. 组装 WinnerDetail
        WinnerDetail.Builder detailBuilder = WinnerDetail.newBuilder()
                .setSeatIndex(winnerSeat)
                .setWinType(winType)
                .setTotalFan(safeTotalFan)
                .addAllFanNames(fanNames == null ? new ArrayList<>() : fanNames);

        if (winner.getFormedSets() != null) {
            detailBuilder.addAllMelds(winner.getFormedSets());
        }

        List<CardInfo> handCards = new ArrayList<>(winner.getHandCards());
        if (isZimo && !handCards.isEmpty()) {
            CardInfo winCard = handCards.remove(handCards.size() - 1);
            detailBuilder.setWinningCard(winCard);
        } else if (this.lastDiscardedCard != null) {
            detailBuilder.setWinningCard(this.lastDiscardedCard);
        }
        detailBuilder.addAllHandCards(handCards);

        // 2. 数值计算核心
        int baseScore = 1; 
        int multi = 1;
        
        // 计算 2 的 safeTotalFan 次方
        for(int i = 0; i < safeTotalFan; i++) {
            multi *= 2; 
        }

        int actualScore = baseScore * multi;
        int totalWinScore = 0;

        // 3. 调用 modifyScore 收钱，且只收未胡玩家的钱
        if (isZimo) {
            // 【自摸】：向所有还在场上（未胡）的玩家分别收取 actualScore
            for (Player p : onlinePlayers.values()) {
                if (p.getSeatIndex() != winnerSeat && !p.isAlreadyHu()) { // 已经胡的人不用赔钱！
                    p.modifyScore(-actualScore);
                    totalWinScore += actualScore;
                }
            }
        } else {
            // 【点炮】：冤有头债有主，只扣点炮者（lastDiscarderSeat）的分数
            Player discarder = getPlayerBySeat(this.lastDiscarderSeat, onlinePlayers, roomPlayers);
            if (discarder != null) {
                discarder.modifyScore(-actualScore);
                totalWinScore = actualScore;
            }
        }
        
        winner.modifyScore(totalWinScore);

        return detailBuilder.build();
    }

    /**
     * 统一下发单局结束战报 (1008)
     */
    private void broadcastRoundEnd(Map<String, Player> onlinePlayers, List<String> roomPlayers) {
        System.out.println("【全局结算】本局彻底结束，开始下发 1008 战报...");

        RoundSummary.Builder summaryBuilder = RoundSummary.newBuilder();

        // 1. 塞入本局产生的所有赢家详情 (如果是流局，这个列表就是空的，前端也不会弹胡牌面板)
        summaryBuilder.addAllWinners(this.currentRoundWinners);

        // 2. 塞入所有玩家的最终分数变动 (直接读取物理累加器，杠分和胡分已经完美融合)
        for (String roomId : roomPlayers) {
            Player p = onlinePlayers.get(roomId);
            if (p != null) {
                PlayerRoundScore scoreInfo = PlayerRoundScore.newBuilder()
                        .setSeatIndex(p.getSeatIndex())
                        .setNickname(p.getNickname() != null ? p.getNickname() : "")
                        .setScoreChange(p.getRoundScoreDelta()) // 直接读取净胜分！
                        .setCurrentTotalScore(p.getScore())
                        .build();
                summaryBuilder.addScores(scoreInfo);
            }
        }

        MainMessage msgEnd = MainMessage.newBuilder()
                .setCode(1008)
                .setRoundSummary(summaryBuilder.build())
                .build();

        for (String roomId : roomPlayers) {
            Player rp = onlinePlayers.get(roomId);
            if (rp != null && rp.getChannel().isActive()) {
                rp.getChannel().writeAndFlush(msgEnd);
            }
        }
    }

    /**
     * 处理玩家在自己回合内发起的主动杠牌 (暗杠 / 补杠)
     * @return boolean 是否杠牌成功（成功则通知 MsgDispatcher 广播）
     */
    public boolean processSelfKong(int seatIndex, CardInfo targetCard, Map<String, Player> onlinePlayers, List<String> roomPlayers) {
        // 1. 极致的安全防范
        if (targetCard == null) return false;
        Player player = getPlayerBySeat(seatIndex, onlinePlayers, roomPlayers);
        if (player == null || player.getHandCards() == null) return false;

        // 2. 统计手中目标牌的数量
        int handMatchCount = 0;
        for (CardInfo c : player.getHandCards()) {
            if (c.getType() == targetCard.getType() && c.getValue() == targetCard.getValue()) {
                handMatchCount++;
            }
        }

        boolean isKongSuccess = false;

        // 3. 分支执行逻辑
        if (handMatchCount == 4) {
            // ==========================================
            // 执行暗杠数据变动
            // ==========================================
            System.out.println("【后端执行】玩家 " + seatIndex + " 触发暗杠！");

            int scorePerPlayer = 2; // 暗杠收2分
            int totalEarned = 0;
            Player kongPlayer = getPlayerBySeat(seatIndex, onlinePlayers, roomPlayers);
            
            if (kongPlayer != null) {
                for (Player p : onlinePlayers.values()) {
                    // 核心过滤：跳过自己，且跳过已经胡牌的玩家！
                    if (p.getSeatIndex() != seatIndex && !p.isAlreadyHu()) {
                        p.modifyScore(-scorePerPlayer); // 存活玩家扣分
                        totalEarned += scorePerPlayer;  // 累加总收益
                    }
                }
                // 结算给杠牌者
                kongPlayer.modifyScore(totalEarned);
            }
            
            // 步骤 A: 安全扣除 4 张手牌
            int removeCount = 0;
            Iterator<CardInfo> iterator = player.getHandCards().iterator();
            while (iterator.hasNext()) {
                CardInfo c = iterator.next();
                if (c.getType() == targetCard.getType() && c.getValue() == targetCard.getValue()) {
                    iterator.remove();
                    removeCount++;
                    if (removeCount == 4) break;
                }
            }

            // 步骤 B: 组装暗杠 CardSet 并放入成牌区
            msg.GameMessage.CardSet anKongSet = msg.GameMessage.CardSet.newBuilder()
                    .setType(msg.GameMessage.ActionType.KONG)
                    .addCards(targetCard).addCards(targetCard)
                    .addCards(targetCard).addCards(targetCard)
                    .build();
            
            if (player.getFormedSets() != null) {
                player.getFormedSets().add(anKongSet);
                isKongSuccess = true;
            }
            
        } else if (handMatchCount >= 1 && player.getFormedSets() != null) {
            // ==========================================
            // 执行补杠数据变动
            // ==========================================
            // 步骤 A: 遍历寻找对应的碰牌组合
            for (int i = 0; i < player.getFormedSets().size(); i++) {
                msg.GameMessage.CardSet set = player.getFormedSets().get(i);
                
                if (set.getType() == msg.GameMessage.ActionType.PONG && set.getCardsCount() > 0) {
                    CardInfo setCard = set.getCards(0);
                    
                    if (setCard.getType() == targetCard.getType() && setCard.getValue() == targetCard.getValue()) {
                        System.out.println("【后端执行】玩家 " + seatIndex + " 触发补杠！");

                        int scorePerPlayer = 1; // 补杠收1分
                        int totalEarned = 0;
                        Player kongPlayer = getPlayerBySeat(seatIndex, onlinePlayers, roomPlayers);
                        
                        if (kongPlayer != null) {
                            for (Player p : onlinePlayers.values()) {
                                // 核心过滤：跳过自己，且跳过已经胡牌的玩家！
                                if (p.getSeatIndex() != seatIndex && !p.isAlreadyHu()) {
                                    p.modifyScore(-scorePerPlayer); // 存活玩家扣分
                                    totalEarned += scorePerPlayer;  // 累加总收益
                                }
                            }
                            // 结算给杠牌者
                            kongPlayer.modifyScore(totalEarned);
                        }
                        
                        // 步骤 B: 从手牌扣除那 1 张用于补杠的牌
                        Iterator<CardInfo> iterator = player.getHandCards().iterator();
                        while (iterator.hasNext()) {
                            CardInfo c = iterator.next();
                            if (c.getType() == targetCard.getType() && c.getValue() == targetCard.getValue()) {
                                iterator.remove();
                                break; 
                            }
                        }

                        // 步骤 C: Protobuf 对象是不可变的，必须创建一个新的 KONG 覆盖原有的 PONG
                        msg.GameMessage.CardSet buKongSet = msg.GameMessage.CardSet.newBuilder()
                                .setType(msg.GameMessage.ActionType.KONG)
                                .addAllCards(set.getCardsList()) // 把原来碰的3张牌加进来
                                .addCards(targetCard)            // 加上第4张牌
                                .build();
                        
                        // 替换原数组中的 PONG 组合
                        player.getFormedSets().set(i, buKongSet);
                        isKongSuccess = true;
                        break;
                    }
                }
            }
        }

        // 4. 发放岭上补牌与状态返回
        if (isKongSuccess) {
            CardInfo replacementCard = drawOneCard();
            if (replacementCard != null) {
                player.getHandCards().add(replacementCard);
                System.out.println("【后端执行】已向玩家发放岭上补牌。");
            }
            return true; 
        }

        return false;
    }

    /**
     * 底层手牌严格排序器
     */
    private void sortCards(List<CardInfo> cards) {
        if (cards == null || cards.isEmpty()) return;
        cards.sort((c1, c2) -> {
            if (c1.getType() != c2.getType()) {
                return Integer.compare(c1.getType(), c2.getType());
            }
            return Integer.compare(c1.getValue(), c2.getValue());
        });
    }

    /**
     * 构建状态同步消息包 (1005)
     */
    public MainMessage buildGameStateSync(List<String> playerCids) {
        GameStateSync.Builder syncBuilder = GameStateSync.newBuilder();
        
        syncBuilder.setCurrentActionSeat(this.currentActionSeat);
        syncBuilder.setRemainingCardsCount(this.deck == null ? 0 : this.deck.size());
        
        // 同步总局数和当前局数
        syncBuilder.setCurrentMatchCount(this.currentMatchCount);
        syncBuilder.setTotalMatchCount(this.maxMatches);
        
        if (this.lastDiscardedCard != null) {
            syncBuilder.setLastDiscardedCard(this.lastDiscardedCard);
        }

        if (!this.globalDiscardedCards.isEmpty()) {
            syncBuilder.addAllGlobalDiscardedCards(this.globalDiscardedCards);
        }

        for (String cid : playerCids) {
            Player p = MsgDispatcher.onlinePlayers.get(cid);
            if (p != null) {
                syncBuilder.addPlayers(PlayerGameInfo.newBuilder()
                        .setNickname(p.getNickname() == null ? "未知玩家" : p.getNickname())
                        .setSeatIndex(p.getSeatIndex())
                        .setScore(p.getScore())
                        .setIsAlreadyHu(p.isAlreadyHu())
                        .setQueSuit(p.getQueSuit())
                        .addAllHandCards(p.getHandCards() == null ? new ArrayList<>() : p.getHandCards())
                        .addAllFixedSets(p.getFormedSets() == null ? new ArrayList<>() : p.getFormedSets()) 
                        .addAllDiscardedCards(p.getDiscardedCards() == null ? new ArrayList<>() : p.getDiscardedCards())
                        .build());
            }
        }

        return MainMessage.newBuilder()
                .setCode(1005)
                .setGameState(syncBuilder.build())
                .build();
    }

    /**
     * 物理抽牌逻辑
     */
    public CardInfo drawOneCard() {
        if (deck != null && !deck.isEmpty()) {
            return deck.remove(0);
        }
        return null;
    }

    /**
     * 辅助方法：根据座位号极其安全地查找玩家
     */
    private Player getPlayerBySeat(int seatIndex, Map<String, Player> onlinePlayers, List<String> roomPlayers) {
        int safeSeat = Math.max(0, seatIndex);
        if (roomPlayers == null || onlinePlayers == null) return null;
        
        for (String cid : roomPlayers) {
            Player p = onlinePlayers.get(cid);
            if (p != null && p.getSeatIndex() == safeSeat) {
                return p;
            }
        }
        return null;
    }

    // --- 状态访问与清理器 ---
    public void clearLastDiscardedCard() { 
        this.lastDiscardedCard = null; 
    }

    // --- 属性访问器 ---
    public int getCurrentActionSeat() { return currentActionSeat; }
    public void setCurrentActionSeat(int seat) { this.currentActionSeat = seat; }
    public List<CardInfo> getDeck() { return deck == null ? new ArrayList<>() : deck; }
    public CardInfo getLastDiscardedCard() { return lastDiscardedCard; }
    public int getCurrentMatchCount() { return currentMatchCount; }
    public ActionStateMachine getStateMachine() { return stateMachine; }
}