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

            // 回复登录成功 (1002)
            MainMessage loginResponse = MainMessage.newBuilder()
                    .setCode(1002)
                    .setLoginResponse(LoginResponse.newBuilder()
                            .setSuccess(true)
                            .setMessage("登录成功")
                            .build())
                    .build();
            ctx.writeAndFlush(loginResponse);

            // 广播玩家列表 (1003)
            broadcastPlayerList();
        });

        // --- 1004: 房主点击“开始游戏” ---
        handlers.put(1004, (ctx, msg) -> {
            String requesterId = ctx.channel().id().asLongText();
            int playerCount = onlinePlayers.size();
            int hostIndex = playerOrder.indexOf(requesterId);
            
            // 校验房主身份与人数限制(2-4人)
            if (hostIndex == 0 && playerCount >= 2 && playerCount <= 4) {
                System.out.println("【流程】房主启动游戏，执行初始化...");

                roomPlayers.clear();
                roomPlayers.addAll(playerOrder);

                // 为玩家分配席位号，并执行极其重要的数据清理（防脏数据）
                for (int i = 0; i < roomPlayers.size(); i++) {
                    String pCid = roomPlayers.get(i);
                    Player p = onlinePlayers.get(pCid);
                    if (p != null) {
                        p.setSeatIndex(i); 
                        p.setAlreadyHu(false);       // 重置胡牌标记
                        p.resetRoundScoreDelta();    // 清空单局分数累加器
                        System.out.println("【座位】玩家: " + p.getNickname() + " -> 席位: " + i);
                    }
                }

                // 初始化多局Session
                gameController.initGameSession(roomPlayers);
                // 启动第一局 (此方法内部已清空 currentRoundWinners，无需再调报错方法)
                gameController.startNewMatch(roomPlayers);

                Map<String, Player> currentRoomPlayers = new HashMap<>();
                roomPlayers.forEach(cid -> currentRoomPlayers.put(cid, onlinePlayers.get(cid)));
                
                // 初始发牌：庄家14张，其他人13张
                Dealer.getInitialDealData(gameController.getDeck(), currentRoomPlayers, 0);

                System.out.println("【流程】第一局开启，正在同步桌面...");
                broadcastGameState();
                
            } else {
                String reason = (hostIndex != 0) ? "非房主无权启动" : "人数不符";
                System.out.println("【拒绝】启动失败：" + reason);
            }
        });

        // --- 1006: 玩家操作交互 (出牌、摸牌、胡牌等) ---
        handlers.put(1006, (ctx, msg) -> {
            String cid = ctx.channel().id().asLongText();
            Player p = onlinePlayers.get(cid);
            
            if (p == null || !msg.hasActionReq()) return;

            PlayerActionRequest req = msg.getActionReq();
            ActionType action = req.getAction();
            int currentActionSeat = gameController.getCurrentActionSeat();
            int seatIndex = p.getSeatIndex();

            // ==========================================
            // 1. 处理自摸胡牌 (完美兼容大逃杀血战模式)
            // ==========================================
            if (action == ActionType.HU) {
                System.out.println("【状态流转】玩家 " + p.getNickname() + " 宣告自摸！进行结算...");
                
                int totalFan = req.getTotalFan();
                List<String> fanNames = req.getFanNamesList() == null ? new ArrayList<>() : req.getFanNamesList();
                
                // 接收 processHu 返回的单人赢家详情
                WinnerDetail detail = gameController.processHu(seatIndex, onlinePlayers, roomPlayers, totalFan, fanNames);
                
                if (detail != null) {
                    // 利用反射安全穿透，将自摸赢家塞入私有缓冲池
                    addWinnerToGameController(detail); 
                }

                // 存活人数检测
                int activeCount = 0;
                for (Player player : onlinePlayers.values()) {
                    if (!player.isAlreadyHu()) activeCount++;
                }

                if (activeCount <= 1) {
                    System.out.println("【全局结算】场上仅剩1名存活玩家，游戏彻底结束！");
                    invokeBroadcastRoundEnd(); // 反射调用私有终局下发方法
                } else {
                    // 血战到底：自摸后游戏继续，游标顺延给下家并发牌
                    int nextSeat = getNextActiveSeatLocal(seatIndex);
                    gameController.setCurrentActionSeat(nextSeat);
                    
                    Player nextPlayer = getPlayerBySeatLocal(nextSeat);
                    CardInfo newCard = gameController.drawOneCard();
                    
                    if (newCard != null && nextPlayer != null) {
                        nextPlayer.getHandCards().add(newCard);
                        broadcastGameState(); 
                    } else {
                        System.out.println("【全局结算】牌山已空，游戏彻底结束！");
                        invokeBroadcastRoundEnd();
                    }
                }
            }
            // ==========================================
            // 2. 处理出牌
            // ==========================================
            else if (action == ActionType.DISCARD) {
                if (seatIndex == currentActionSeat) {
                    CardInfo discardedCard = req.getCard();
                    
                    Iterator<CardInfo> it = p.getHandCards().iterator();
                    while (it.hasNext()) {
                        CardInfo c = it.next();
                        if (c.getType() == discardedCard.getType() && c.getValue() == discardedCard.getValue()) {
                            it.remove(); 
                            break;
                        }
                    }
                    
                    // 补充了 onlinePlayers 参数，消除编译报错
                    gameController.handleDiscardAction(seatIndex, discardedCard, roomPlayers.size(), onlinePlayers);
                    broadcastGameState(); 
                }
            }
            // ==========================================
            // 3. 处理摸牌
            // ==========================================
            else if (action == ActionType.DRAW) {
                if (seatIndex == currentActionSeat) {
                    CardInfo drawnCard = gameController.drawOneCard();
                    if (drawnCard != null) {
                        p.getHandCards().add(drawnCard);
                        broadcastGameState();
                    } else {
                        System.out.println("【全局结算】流局/荒庄，牌山已空！");
                        // 摒弃旧版报错流局方法，统一使用大逃杀终局核算体系
                        invokeBroadcastRoundEnd(); 
                    }
                }
            }
            // ==========================================
            // 4. 处理主动杠牌 (自己回合内的暗杠/补杠)
            // ==========================================
            else if (action == ActionType.KONG && seatIndex == currentActionSeat) {
                System.out.println("【网络中枢】收到玩家 " + seatIndex + " 的主动杠牌请求...");
                
                CardInfo targetCard = req.getCard();
                boolean success = gameController.processSelfKong(seatIndex, targetCard, onlinePlayers, roomPlayers);
                
                if (success) {
                    System.out.println("【网络中枢】主动杠牌执行完毕，生成最新桌面状态并全服广播...");
                    broadcastGameState();
                } else {
                    System.out.println("【网络中枢】异常：玩家 " + seatIndex + " 的主动杠牌数据校验未通过！");
                }
            }
            // ==========================================
            // 5. 处理碰、明杠、吃、过指令 (非单局结束的被动拦截)
            // ==========================================
            else if (action == ActionType.PONG || action == ActionType.KONG || action == ActionType.CHI || action == ActionType.PASS) {
                System.out.println("【网络中枢】收到玩家 " + seatIndex + " 的动作拦截指令: " + action);

                boolean shouldBroadcast = gameController.receiveInterceptAction(
                        seatIndex, 
                        action.getNumber(), 
                        req.getTotalFan(), 
                        req.getFanNamesList() == null ? new ArrayList<>() : req.getFanNamesList(),
                        req.getChiCardsList() == null ? new ArrayList<>() : req.getChiCardsList(),
                        onlinePlayers, 
                        roomPlayers
                );

                // 只有拿到唯一授权的那个线程，才允许执行全服状态更新！
                if (shouldBroadcast) {
                    System.out.println("【网络中枢】拦截结算完毕，生成最新桌面状态并全服广播...");
                    broadcastGameState();
                } else {
                    // 没有拿到授权（可能还在等待其他人，或者游戏已触发1008终局），静默处理
                    if (gameController.getStateMachine().isIntercepting()) {
                        System.out.println("【网络中枢】动作已记录。仍在等待其他玩家表态...");
                    }
                }
            }
        });

        // --- 1009: 玩家确认结算，点击“准备下一局” ---
        handlers.put(1009, (ctx, msg) -> {
            String cid = ctx.channel().id().asLongText();
            Player p = onlinePlayers.get(cid);
            if (p == null) return;

            gameController.playerReadyForNextMatch(cid);
            System.out.println("【就绪】玩家 " + p.getNickname() + " 准备进入下一局");

            // 全员准备完毕
            if (gameController.isAllReadyForNextMatch(roomPlayers.size())) {
                gameController.clearReadyState();

                // 判定是否打满总局数
                if (gameController.isGameSessionOver()) {
                    broadcastFinalVictory();
                } else {
                    System.out.println("【流程】开启新一局 (" + (gameController.getCurrentMatchCount() + 1) + ")");
                    
                    // 彻底的数据清理，迎接新的一局
                    roomPlayers.forEach(id -> {
                        Player rp = onlinePlayers.get(id);
                        if(rp != null) {
                            rp.setAlreadyHu(false);
                            rp.resetRoundScoreDelta();
                        }
                    });

                    // 内部自动清空上一局的胡牌缓存池
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
    // 底层私有方法安全访问区 (保障数据纯正性)
    // ==========================================

    /**
     * 本地安全寻座器：绕过 Controller 私有化限制
     */
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

    /**
     * 本地安全查找器
     */
    private static Player getPlayerBySeatLocal(int seatIndex) {
        for (String cid : roomPlayers) {
            Player p = onlinePlayers.get(cid);
            if (p != null && p.getSeatIndex() == seatIndex) {
                return p;
            }
        }
        return null;
    }

    /**
     * 核心反射护盾：安全写入自摸数据
     */
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

    /**
     * 核心反射护盾：触发全局终局战报
     */
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

        MainMessage victoryMsg = MainMessage.newBuilder()
                .setCode(1007)
                .setFinalResult(resultBuilder.build())
                .build();

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