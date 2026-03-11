package com.example.handler;

import com.example.model.Player;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.Map;
import msg.GameMessage.*;

public class Dealer {

    /**
     * 【修改】更名为 createMahjongDeck，增加到 136 张牌。
     * 原因：麻将包含万、筒、条（各 36 张）和风/字牌（28 张），共 136 张，且每种牌有 4 张重复。
     */
    public static List<CardInfo> createMahjongDeck() {
        List<CardInfo> deck = new ArrayList<>();
        // 1. 万(1), 筒(2), 条(3) - 各 1-9 点
        for (int type = 1; type <= 3; type++) {
            for (int val = 1; val <= 9; val++) {
                for (int count = 0; count < 4; count++) { // 每种牌 4 张
                    deck.add(CardInfo.newBuilder().setType(type).setValue(val).build());
                }
            }
        }
        // 2. 风/字牌(4) - 1-7 (东南西北中发白)
        // for (int val = 1; val <= 7; val++) {
        //     for (int count = 0; count < 4; count++) {
        //         deck.add(CardInfo.newBuilder().setType(4).setValue(val).build());
        //     }
        // }
        Collections.shuffle(deck);
        return deck;
    }

    /**
     * 【修改】逻辑重构为“初始发牌”。
     * 原因：麻将不再分 round 1-4 补牌，而是开局每个玩家分 13 张，庄家 14 张。
     */
    public static GameStateSync getInitialDealData(List<CardInfo> deck, Map<String, Player> players, int dealerSeat) {
        GameStateSync.Builder syncBuilder = GameStateSync.newBuilder();

        for (Player p : players.values()) {
            p.getHandCards().clear();
            // 初始发 13 张
            int count = 13;
            // 【修改】庄家初始多发一张牌（14张）直接进入出牌阶段
            if (p.getSeatIndex() == dealerSeat) {
                count = 14;
                p.setMyTurn(true);
                syncBuilder.setCurrentActionSeat(dealerSeat);
            }

            for (int i = 0; i < count; i++) {
                if (!deck.isEmpty()) {
                    p.getHandCards().add(deck.remove(0));
                }
            }

            // 封装玩家信息
            PlayerGameInfo pInfo = PlayerGameInfo.newBuilder()
                    .setNickname(p.getNickname())
                    .setSeatIndex(p.getSeatIndex())
                    .addAllHandCards(p.getHandCards())
                    .setScore(p.getScore())
                    .build();
            
            syncBuilder.addPlayers(pInfo);
        }

        syncBuilder.setRemainingCardsCount(deck.size());
        return syncBuilder.build();
    }

    /**
     * 【新增】摸牌逻辑
     * 原因：麻将回合制的核心动作。
     */
    public static CardInfo drawCard(List<CardInfo> deck) {
        if (deck.isEmpty()) return null;
        return deck.remove(0);
    }
}