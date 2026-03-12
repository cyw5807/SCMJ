package com.example.handler;

import java.util.*;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.stream.Collectors;

import com.example.model.Player;
import io.netty.channel.ChannelHandlerContext;
import msg.GameMessage.*;

/**
 * 消息分发器：负责处理所有客户端指令并维护游戏流转
 */
public class MsgDispatcher {
    private static final Map<Integer, CmdHandler> handlers = new HashMap<>();

    public static List<String> roomPlayers = new ArrayList<>();

    // 核心组件：游戏逻辑控制器
    private static final GameController gameController = new GameController();

    // 存储在线玩家：Channel ID -> Player 对象
    public static final Map<String, Player> onlinePlayers = new ConcurrentHashMap<>();

    // 存储加入顺序：第一个元素即为房主
    public static final List<String> playerOrder = new CopyOnWriteArrayList<>();

    static {
        // --- 1001: 登录请求处理 ---
        handlers.put(1001, (ctx, msg) -> {
            String cid = ctx.channel().id().asLongText();
            String nickname = msg.getLoginRequest().getNickname();
            String channelId = ctx.channel().id().asLongText();

            System.out.println("【登录处理】收到请求 - 昵称: " + nickname);

            Player player = new Player(cid, nickname, ctx.channel());
            onlinePlayers.put(channelId, player);
            if (!playerOrder.contains(channelId)) {
                playerOrder.add(channelId);
            }

            MainMessage loginResponse = MainMessage.newBuilder()
                    .setCode(1002)
                    .setLoginResponse(LoginResponse.newBuilder()
                            .setSuccess(true)
                            .setMessage("登录成功")
                            .build())
                    .build();
            ctx.writeAndFlush(loginResponse);

            broadcastPlayerList();
        });

        // --- 1004: 房主点击“开始游戏” ---
        handlers.put(1004, (ctx, msg) -> {
            String requesterId = ctx.channel().id().asLongText();
            int playerCount = onlinePlayers.size();
            int hostIndex = playerOrder.indexOf(requesterId);
            
            if (hostIndex == 0 && playerCount >= 2 && playerCount <= 4) {
                System.out.println("【流程】房主启动游戏，执行初始化...");

                roomPlayers.clear();
                roomPlayers.addAll(playerOrder);

                for (int i = 0; i < roomPlayers.size(); i++) {
                    String pCid = roomPlayers.get(i);
                    Player p = onlinePlayers.get(pCid);
                    if (p != null) {
                        p.setSeatIndex(i); 
                        p.setAlreadyHu(false);       
                        p.resetRoundScoreDelta();    
                        System.out.println("【座位】玩家: " + p.getNickname() + " -> 席位: " + i);
                    }
                }

                gameController.initGameSession(roomPlayers);
                gameController.startNewMatch(roomPlayers);

                Map<String, Player> currentRoomPlayers = new HashMap<>();
                roomPlayers.forEach(cid -> currentRoomPlayers.put(cid, onlinePlayers.get(cid)));
                
                Dealer.getInitialDealData(gameController.getDeck(), currentRoomPlayers, 0);

                System.out.println("【流程】第一局开启，正在同步桌面...");
                broadcastGameState();
                
            } else {
                String reason = (hostIndex != 0) ? "非房主无权启动" : "人数不符";
                System.out.println("【拒绝】启动失败：" + reason);
            }
        });

        // --- 1006: 玩家操作交互 (核心重构区) ---
        handlers.put(1006, (ctx, msg) -> {
            String cid = ctx.channel().id().asLongText();
            Player p = onlinePlayers.get(cid);
            
            if (p == null || !msg.hasActionReq()) return;

            PlayerActionRequest req = msg.getActionReq();
            ActionType action = req.getAction();
            int currentActionSeat = gameController.getCurrentActionSeat();
            int seatIndex = p.getSeatIndex();

            // 处理前端发来的定缺指令
            if (action == ActionType.DING_QUE) {
                // 如果已经定缺，绝对不允许修改
                if (p.getQueSuit() != -1) {
                    System.out.println("【防作弊】玩家 " + seatIndex + " 试图修改定缺，已拦截！");
                    return;
                }
                
                int suit = req.getCard().getType(); 
                p.setQueSuit(suit);
                System.out.println("【定缺】玩家 " + seatIndex + " 定缺花色: " + suit);
                broadcastGameState(); 
                return;
            }

            // 【定缺护盾】：如果全场还有任何人没定缺，绝对禁止出牌、摸牌、碰杠胡！
            for (String rpCid : roomPlayers) {
                Player rp = onlinePlayers.get(rpCid);
                if (rp != null && rp.getQueSuit() == -1) {
                    return; 
                }
            }
            
            // 获取当前系统是否处于“拦截期”
            boolean isIntercepting = gameController.getStateMachine().isIntercepting();

            System.out.println("【网络中枢】收到玩家 " + seatIndex + " 操作: " + action + " | 行动位: " + currentActionSeat + " | 拦截模式: " + isIntercepting);

            // ==========================================
            // 模式 A：被动拦截期 (点炮胡、吃、碰、明杠、过)
            // ==========================================
            if (isIntercepting) {
                if (action == ActionType.HU || action == ActionType.PONG || action == ActionType.KONG || action == ActionType.CHI || action == ActionType.PASS) {
                    
                    boolean shouldBroadcast = gameController.receiveInterceptAction(
                            seatIndex, action.getNumber(), req.getTotalFan(), 
                            req.getFanNamesList() == null ? new ArrayList<>() : req.getFanNamesList(),
                            req.getChiCardsList() == null ? new ArrayList<>() : req.getChiCardsList(),
                            onlinePlayers, roomPlayers
                    );

                    if (shouldBroadcast) {
                        System.out.println("【网络中枢】拦截结算完毕，生成最新状态并全服广播...");
                        broadcastGameState();
                    } else {
                        if (gameController.getStateMachine().isIntercepting()) {
                            System.out.println("【网络中枢】动作已记录入状态机。等待其他玩家表态...");
                        }
                    }
                } else {
                    System.out.println("【系统护盾】拦截期非法动作，已坚决丢弃!");
                }
                return; // 拦截模式下，绝对禁止往下执行任何主动回合代码
            }

            // ==========================================
            // 模式 B：主动回合期 (摸牌后：自摸、出牌、暗杠/补杠)
            // ==========================================
            if (seatIndex == currentActionSeat && !p.isAlreadyHu()) {
                if (action == ActionType.HU) {
                    System.out.println("【状态流转】玩家 " + p.getNickname() + " 宣告自摸！进行结算...");
                    WinnerDetail detail = gameController.processHu(seatIndex, onlinePlayers, roomPlayers, req.getTotalFan(), req.getFanNamesList());
                    if (detail != null) {
                        addWinnerToGameController(detail); 
                    }

                    int activeCount = 0;
                    for (Player player : onlinePlayers.values()) {
                        if (!player.isAlreadyHu()) activeCount++;
                    }

                    if (activeCount <= 1) {
                        System.out.println("【全局结算】场上仅剩1名存活玩家，游戏彻底结束！");
                        invokeBroadcastRoundEnd(); 
                    } else {
                        // 血战到底继续：游标顺延
                        int nextSeat = getNextActiveSeatLocal(seatIndex);
                        gameController.setCurrentActionSeat(nextSeat);
                        Player nextPlayer = getPlayerBySeatLocal(nextSeat);
                        CardInfo newCard = gameController.drawOneCard();
                        
                        if (newCard != null && nextPlayer != null) {
                            nextPlayer.getHandCards().add(newCard);
                            // 必须清除桌面的物理残留牌，否则会毒害前端的状态机！
                            gameController.clearLastDiscardedCard();
                            broadcastGameState(); 
                        } else {
                            System.out.println("【全局结算】牌山已空，游戏彻底结束！");
                            invokeBroadcastRoundEnd();
                        }
                    }
                }
                else if (action == ActionType.DISCARD) {
                    CardInfo discardedCard = req.getCard();
                    Iterator<CardInfo> it = p.getHandCards().iterator();
                    while (it.hasNext()) {
                        CardInfo c = it.next();
                        if (c.getType() == discardedCard.getType() && c.getValue() == discardedCard.getValue()) {
                            it.remove(); 
                            break;
                        }
                    }
                    gameController.handleDiscardAction(seatIndex, discardedCard, roomPlayers.size(), onlinePlayers);
                    broadcastGameState(); 
                }
                else if (action == ActionType.KONG) {
                    boolean success = gameController.processSelfKong(seatIndex, req.getCard(), onlinePlayers, roomPlayers);
                    if (success) broadcastGameState();
                }
                else if (action == ActionType.DRAW) {
                    CardInfo drawnCard = gameController.drawOneCard();
                    if (drawnCard != null) {
                        p.getHandCards().add(drawnCard);
                        broadcastGameState();
                    } else {
                        invokeBroadcastRoundEnd(); 
                    }
                }
            } else {
                System.out.println("【系统护盾】当前非玩家 " + seatIndex + " 的回合，或该玩家已胡牌退出战斗，操作丢弃!");
            }
        });

        // --- 1009: 玩家确认结算，点击“准备下一局” ---
        handlers.put(1009, (ctx, msg) -> {
            String cid = ctx.channel().id().asLongText();
            Player p = onlinePlayers.get(cid);
            if (p == null) return;

            gameController.playerReadyForNextMatch(cid);
            System.out.println("【就绪】玩家 " + p.getNickname() + " 准备进入下一局");

            if (gameController.isAllReadyForNextMatch(roomPlayers.size())) {
                gameController.clearReadyState();

                if (gameController.isGameSessionOver()) {
                    broadcastFinalVictory();
                } else {
                    System.out.println("【流程】开启新一局 (" + (gameController.getCurrentMatchCount() + 1) + ")");
                    
                    roomPlayers.forEach(id -> {
                        Player rp = onlinePlayers.get(id);
                        if(rp != null) {
                            rp.setAlreadyHu(false);
                            rp.resetRoundScoreDelta();
                        }
                    });

                    gameController.startNewMatch(roomPlayers);
                    
                    Map<String, Player> currentRoomPlayers = new HashMap<>();
                    roomPlayers.forEach(id -> currentRoomPlayers.put(id, onlinePlayers.get(id)));
                    
                    Dealer.getInitialDealData(gameController.getDeck(), currentRoomPlayers, gameController.getCurrentActionSeat());
                    broadcastGameState(); 
                }
            }
        });
    }

    // ==========================================
    // 底层私有方法安全访问区
    // ==========================================

    private static int getNextActiveSeatLocal(int currentSeat) {
        int total = roomPlayers.size();
        for (int i = 1; i <= total; i++) {
            int next = (currentSeat + i) % total;
            Player p = getPlayerBySeatLocal(next);
            if (p != null && !p.isAlreadyHu()) {
                return next;
            }
        }
        return currentSeat;
    }

    private static Player getPlayerBySeatLocal(int seatIndex) {
        for (String cid : roomPlayers) {
            Player p = onlinePlayers.get(cid);
            if (p != null && p.getSeatIndex() == seatIndex) {
                return p;
            }
        }
        return null;
    }

    private static void addWinnerToGameController(WinnerDetail detail) {
        try {
            java.lang.reflect.Field field = GameController.class.getDeclaredField("currentRoundWinners");
            field.setAccessible(true);
            @SuppressWarnings("unchecked")
            List<WinnerDetail> winners = (List<WinnerDetail>) field.get(gameController);
            winners.add(detail);
        } catch (Exception e) {
            System.err.println("【系统异常】反射写入赢家数据失败：" + e.getMessage());
        }
    }

    private static void invokeBroadcastRoundEnd() {
        try {
            java.lang.reflect.Method method = GameController.class.getDeclaredMethod("broadcastRoundEnd", Map.class, List.class);
            method.setAccessible(true);
            method.invoke(gameController, onlinePlayers, roomPlayers);
        } catch (Exception e) {
            System.err.println("【系统异常】执行统一下发失败：" + e.getMessage());
        }
    }

    // ==========================================
    // 基础公用广播体系
    // ==========================================

    public static void broadcastGameState() {
        MainMessage syncMsg = gameController.buildGameStateSync(roomPlayers);
        for (String cid : roomPlayers) {
            Player p = onlinePlayers.get(cid);
            if (p != null && p.getChannel().isActive()) {
                p.getChannel().writeAndFlush(syncMsg);
            }
        }
    }

    public static void broadcastPlayerList() {
        PlayerList.Builder listBuilder = PlayerList.newBuilder();
        for (int i = 0; i < playerOrder.size(); i++) {
            String cid = playerOrder.get(i);
            Player p = onlinePlayers.get(cid);
            if (p != null) {
                listBuilder.addPlayers(PlayerInfo.newBuilder()
                        .setNickname(p.getNickname())
                        .setIsHost(i == 0)
                        .setSeatIndex(i)
                        .build());
            }
        }
        MainMessage msg = MainMessage.newBuilder().setCode(1003).setPlayerList(listBuilder.build()).build();
        onlinePlayers.values().forEach(p -> p.getChannel().writeAndFlush(msg));
    }

    public static void broadcastFinalVictory() {
        System.out.println("【终局】总局数已满，推送总榜单 (1007)");
        List<Player> sortedPlayers = roomPlayers.stream()
                .map(onlinePlayers::get)
                .filter(Objects::nonNull)
                .sorted((p1, p2) -> Integer.compare(p2.getScore(), p1.getScore()))
                .collect(Collectors.toList());

        if (sortedPlayers.isEmpty()) return;
        Player winner = sortedPlayers.get(0);

        FinalResult.Builder resultBuilder = FinalResult.newBuilder()
                .setWinnerNickname(winner.getNickname())
                .setWinningScore(winner.getScore())
                .setEndReason("总局数已满");

        for (int i = 0; i < sortedPlayers.size(); i++) {
            Player p = sortedPlayers.get(i);
            resultBuilder.addLeaderBoard(PlayerFinalInfo.newBuilder()
                    .setNickname(p.getNickname())
                    .setTotalScore(p.getScore())
                    .setSeatIndex(p.getSeatIndex())
                    .setRank(i + 1)
                    .build());
        }
        MainMessage victoryMsg = MainMessage.newBuilder().setCode(1007).setFinalResult(resultBuilder.build()).build();
        roomPlayers.forEach(cid -> {
            Player p = onlinePlayers.get(cid);
            if (p != null && p.getChannel().isActive()) {
                p.getChannel().writeAndFlush(victoryMsg);
            }
        });
    }

    public static void removePlayer(String channelId) {
        onlinePlayers.remove(channelId);
        playerOrder.remove(channelId);
        broadcastPlayerList();
    }

    public static void dispatch(ChannelHandlerContext ctx, MainMessage msg) {
        CmdHandler handler = handlers.get(msg.getCode());
        if (handler != null) {
            handler.execute(ctx, msg);
        }
    }
}