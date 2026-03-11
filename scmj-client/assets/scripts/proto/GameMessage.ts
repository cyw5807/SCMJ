export const enum ActionType {
  DRAW = "DRAW",
  DISCARD = "DISCARD",
  PONG = "PONG",
  KONG = "KONG",
  HU = "HU",
  CHI = "CHI",
  PASS = "PASS",
}

export const encodeActionType: { [key: string]: number } = {
  DRAW: 0,
  DISCARD: 1,
  PONG: 2,
  KONG: 3,
  HU: 4,
  CHI: 5,
  PASS: 6,
};

export const decodeActionType: { [key: number]: ActionType } = {
  0: ActionType.DRAW,
  1: ActionType.DISCARD,
  2: ActionType.PONG,
  3: ActionType.KONG,
  4: ActionType.HU,
  5: ActionType.CHI,
  6: ActionType.PASS,
};

export interface CardInfo {
  type?: number;
  value?: number;
}

export function encodeCardInfo(message: CardInfo): Uint8Array {
  let bb = popByteBuffer();
  _encodeCardInfo(message, bb);
  return toUint8Array(bb);
}

function _encodeCardInfo(message: CardInfo, bb: ByteBuffer): void {
  // optional int32 type = 1;
  let $type = message.type;
  if ($type !== undefined) {
    writeVarint32(bb, 8);
    writeVarint64(bb, intToLong($type));
  }

  // optional int32 value = 2;
  let $value = message.value;
  if ($value !== undefined) {
    writeVarint32(bb, 16);
    writeVarint64(bb, intToLong($value));
  }
}

export function decodeCardInfo(binary: Uint8Array): CardInfo {
  return _decodeCardInfo(wrapByteBuffer(binary));
}

function _decodeCardInfo(bb: ByteBuffer): CardInfo {
  let message: CardInfo = {} as any;

  end_of_message: while (!isAtEnd(bb)) {
    let tag = readVarint32(bb);

    switch (tag >>> 3) {
      case 0:
        break end_of_message;

      // optional int32 type = 1;
      case 1: {
        message.type = readVarint32(bb);
        break;
      }

      // optional int32 value = 2;
      case 2: {
        message.value = readVarint32(bb);
        break;
      }

      default:
        skipUnknownField(bb, tag & 7);
    }
  }

  return message;
}

export interface CardSet {
  type?: ActionType;
  cards?: CardInfo[];
}

export function encodeCardSet(message: CardSet): Uint8Array {
  let bb = popByteBuffer();
  _encodeCardSet(message, bb);
  return toUint8Array(bb);
}

function _encodeCardSet(message: CardSet, bb: ByteBuffer): void {
  // optional ActionType type = 1;
  let $type = message.type;
  if ($type !== undefined) {
    writeVarint32(bb, 8);
    writeVarint32(bb, encodeActionType[$type]);
  }

  // repeated CardInfo cards = 2;
  let array$cards = message.cards;
  if (array$cards !== undefined) {
    for (let value of array$cards) {
      writeVarint32(bb, 18);
      let nested = popByteBuffer();
      _encodeCardInfo(value, nested);
      writeVarint32(bb, nested.limit);
      writeByteBuffer(bb, nested);
      pushByteBuffer(nested);
    }
  }
}

export function decodeCardSet(binary: Uint8Array): CardSet {
  return _decodeCardSet(wrapByteBuffer(binary));
}

function _decodeCardSet(bb: ByteBuffer): CardSet {
  let message: CardSet = {} as any;

  end_of_message: while (!isAtEnd(bb)) {
    let tag = readVarint32(bb);

    switch (tag >>> 3) {
      case 0:
        break end_of_message;

      // optional ActionType type = 1;
      case 1: {
        message.type = decodeActionType[readVarint32(bb)];
        break;
      }

      // repeated CardInfo cards = 2;
      case 2: {
        let limit = pushTemporaryLength(bb);
        let values = message.cards || (message.cards = []);
        values.push(_decodeCardInfo(bb));
        bb.limit = limit;
        break;
      }

      default:
        skipUnknownField(bb, tag & 7);
    }
  }

  return message;
}

export interface PlayerGameInfo {
  nickname?: string;
  seatIndex?: number;
  handCards?: CardInfo[];
  fixedSets?: CardSet[];
  discardedCards?: CardInfo[];
  score?: number;
  isAlreadyHu?: boolean;
}

export function encodePlayerGameInfo(message: PlayerGameInfo): Uint8Array {
  let bb = popByteBuffer();
  _encodePlayerGameInfo(message, bb);
  return toUint8Array(bb);
}

function _encodePlayerGameInfo(message: PlayerGameInfo, bb: ByteBuffer): void {
  // optional string nickname = 1;
  let $nickname = message.nickname;
  if ($nickname !== undefined) {
    writeVarint32(bb, 10);
    writeString(bb, $nickname);
  }

  // optional int32 seatIndex = 2;
  let $seatIndex = message.seatIndex;
  if ($seatIndex !== undefined) {
    writeVarint32(bb, 16);
    writeVarint64(bb, intToLong($seatIndex));
  }

  // repeated CardInfo handCards = 3;
  let array$handCards = message.handCards;
  if (array$handCards !== undefined) {
    for (let value of array$handCards) {
      writeVarint32(bb, 26);
      let nested = popByteBuffer();
      _encodeCardInfo(value, nested);
      writeVarint32(bb, nested.limit);
      writeByteBuffer(bb, nested);
      pushByteBuffer(nested);
    }
  }

  // repeated CardSet fixedSets = 4;
  let array$fixedSets = message.fixedSets;
  if (array$fixedSets !== undefined) {
    for (let value of array$fixedSets) {
      writeVarint32(bb, 34);
      let nested = popByteBuffer();
      _encodeCardSet(value, nested);
      writeVarint32(bb, nested.limit);
      writeByteBuffer(bb, nested);
      pushByteBuffer(nested);
    }
  }

  // repeated CardInfo discardedCards = 5;
  let array$discardedCards = message.discardedCards;
  if (array$discardedCards !== undefined) {
    for (let value of array$discardedCards) {
      writeVarint32(bb, 42);
      let nested = popByteBuffer();
      _encodeCardInfo(value, nested);
      writeVarint32(bb, nested.limit);
      writeByteBuffer(bb, nested);
      pushByteBuffer(nested);
    }
  }

  // optional int32 score = 6;
  let $score = message.score;
  if ($score !== undefined) {
    writeVarint32(bb, 48);
    writeVarint64(bb, intToLong($score));
  }

  // optional bool isAlreadyHu = 7;
  let $isAlreadyHu = message.isAlreadyHu;
  if ($isAlreadyHu !== undefined) {
    writeVarint32(bb, 56);
    writeByte(bb, $isAlreadyHu ? 1 : 0);
  }
}

export function decodePlayerGameInfo(binary: Uint8Array): PlayerGameInfo {
  return _decodePlayerGameInfo(wrapByteBuffer(binary));
}

function _decodePlayerGameInfo(bb: ByteBuffer): PlayerGameInfo {
  let message: PlayerGameInfo = {} as any;

  end_of_message: while (!isAtEnd(bb)) {
    let tag = readVarint32(bb);

    switch (tag >>> 3) {
      case 0:
        break end_of_message;

      // optional string nickname = 1;
      case 1: {
        message.nickname = readString(bb, readVarint32(bb));
        break;
      }

      // optional int32 seatIndex = 2;
      case 2: {
        message.seatIndex = readVarint32(bb);
        break;
      }

      // repeated CardInfo handCards = 3;
      case 3: {
        let limit = pushTemporaryLength(bb);
        let values = message.handCards || (message.handCards = []);
        values.push(_decodeCardInfo(bb));
        bb.limit = limit;
        break;
      }

      // repeated CardSet fixedSets = 4;
      case 4: {
        let limit = pushTemporaryLength(bb);
        let values = message.fixedSets || (message.fixedSets = []);
        values.push(_decodeCardSet(bb));
        bb.limit = limit;
        break;
      }

      // repeated CardInfo discardedCards = 5;
      case 5: {
        let limit = pushTemporaryLength(bb);
        let values = message.discardedCards || (message.discardedCards = []);
        values.push(_decodeCardInfo(bb));
        bb.limit = limit;
        break;
      }

      // optional int32 score = 6;
      case 6: {
        message.score = readVarint32(bb);
        break;
      }

      // optional bool isAlreadyHu = 7;
      case 7: {
        message.isAlreadyHu = !!readByte(bb);
        break;
      }

      default:
        skipUnknownField(bb, tag & 7);
    }
  }

  return message;
}

export interface LoginRequest {
  nickname?: string;
}

export function encodeLoginRequest(message: LoginRequest): Uint8Array {
  let bb = popByteBuffer();
  _encodeLoginRequest(message, bb);
  return toUint8Array(bb);
}

function _encodeLoginRequest(message: LoginRequest, bb: ByteBuffer): void {
  // optional string nickname = 1;
  let $nickname = message.nickname;
  if ($nickname !== undefined) {
    writeVarint32(bb, 10);
    writeString(bb, $nickname);
  }
}

export function decodeLoginRequest(binary: Uint8Array): LoginRequest {
  return _decodeLoginRequest(wrapByteBuffer(binary));
}

function _decodeLoginRequest(bb: ByteBuffer): LoginRequest {
  let message: LoginRequest = {} as any;

  end_of_message: while (!isAtEnd(bb)) {
    let tag = readVarint32(bb);

    switch (tag >>> 3) {
      case 0:
        break end_of_message;

      // optional string nickname = 1;
      case 1: {
        message.nickname = readString(bb, readVarint32(bb));
        break;
      }

      default:
        skipUnknownField(bb, tag & 7);
    }
  }

  return message;
}

export interface LoginResponse {
  success?: boolean;
  message?: string;
}

export function encodeLoginResponse(message: LoginResponse): Uint8Array {
  let bb = popByteBuffer();
  _encodeLoginResponse(message, bb);
  return toUint8Array(bb);
}

function _encodeLoginResponse(message: LoginResponse, bb: ByteBuffer): void {
  // optional bool success = 1;
  let $success = message.success;
  if ($success !== undefined) {
    writeVarint32(bb, 8);
    writeByte(bb, $success ? 1 : 0);
  }

  // optional string message = 2;
  let $message = message.message;
  if ($message !== undefined) {
    writeVarint32(bb, 18);
    writeString(bb, $message);
  }
}

export function decodeLoginResponse(binary: Uint8Array): LoginResponse {
  return _decodeLoginResponse(wrapByteBuffer(binary));
}

function _decodeLoginResponse(bb: ByteBuffer): LoginResponse {
  let message: LoginResponse = {} as any;

  end_of_message: while (!isAtEnd(bb)) {
    let tag = readVarint32(bb);

    switch (tag >>> 3) {
      case 0:
        break end_of_message;

      // optional bool success = 1;
      case 1: {
        message.success = !!readByte(bb);
        break;
      }

      // optional string message = 2;
      case 2: {
        message.message = readString(bb, readVarint32(bb));
        break;
      }

      default:
        skipUnknownField(bb, tag & 7);
    }
  }

  return message;
}

export interface PlayerList {
  players?: PlayerInfo[];
}

export function encodePlayerList(message: PlayerList): Uint8Array {
  let bb = popByteBuffer();
  _encodePlayerList(message, bb);
  return toUint8Array(bb);
}

function _encodePlayerList(message: PlayerList, bb: ByteBuffer): void {
  // repeated PlayerInfo players = 1;
  let array$players = message.players;
  if (array$players !== undefined) {
    for (let value of array$players) {
      writeVarint32(bb, 10);
      let nested = popByteBuffer();
      _encodePlayerInfo(value, nested);
      writeVarint32(bb, nested.limit);
      writeByteBuffer(bb, nested);
      pushByteBuffer(nested);
    }
  }
}

export function decodePlayerList(binary: Uint8Array): PlayerList {
  return _decodePlayerList(wrapByteBuffer(binary));
}

function _decodePlayerList(bb: ByteBuffer): PlayerList {
  let message: PlayerList = {} as any;

  end_of_message: while (!isAtEnd(bb)) {
    let tag = readVarint32(bb);

    switch (tag >>> 3) {
      case 0:
        break end_of_message;

      // repeated PlayerInfo players = 1;
      case 1: {
        let limit = pushTemporaryLength(bb);
        let values = message.players || (message.players = []);
        values.push(_decodePlayerInfo(bb));
        bb.limit = limit;
        break;
      }

      default:
        skipUnknownField(bb, tag & 7);
    }
  }

  return message;
}

export interface PlayerInfo {
  nickname?: string;
  isHost?: boolean;
  seatIndex?: number;
}

export function encodePlayerInfo(message: PlayerInfo): Uint8Array {
  let bb = popByteBuffer();
  _encodePlayerInfo(message, bb);
  return toUint8Array(bb);
}

function _encodePlayerInfo(message: PlayerInfo, bb: ByteBuffer): void {
  // optional string nickname = 1;
  let $nickname = message.nickname;
  if ($nickname !== undefined) {
    writeVarint32(bb, 10);
    writeString(bb, $nickname);
  }

  // optional bool isHost = 2;
  let $isHost = message.isHost;
  if ($isHost !== undefined) {
    writeVarint32(bb, 16);
    writeByte(bb, $isHost ? 1 : 0);
  }

  // optional int32 seatIndex = 3;
  let $seatIndex = message.seatIndex;
  if ($seatIndex !== undefined) {
    writeVarint32(bb, 24);
    writeVarint64(bb, intToLong($seatIndex));
  }
}

export function decodePlayerInfo(binary: Uint8Array): PlayerInfo {
  return _decodePlayerInfo(wrapByteBuffer(binary));
}

function _decodePlayerInfo(bb: ByteBuffer): PlayerInfo {
  let message: PlayerInfo = {} as any;

  end_of_message: while (!isAtEnd(bb)) {
    let tag = readVarint32(bb);

    switch (tag >>> 3) {
      case 0:
        break end_of_message;

      // optional string nickname = 1;
      case 1: {
        message.nickname = readString(bb, readVarint32(bb));
        break;
      }

      // optional bool isHost = 2;
      case 2: {
        message.isHost = !!readByte(bb);
        break;
      }

      // optional int32 seatIndex = 3;
      case 3: {
        message.seatIndex = readVarint32(bb);
        break;
      }

      default:
        skipUnknownField(bb, tag & 7);
    }
  }

  return message;
}

export interface GameStateSync {
  currentActionSeat?: number;
  players?: PlayerGameInfo[];
  lastDiscardedCard?: CardInfo;
  remainingCardsCount?: number;
  globalDiscardedCards?: CardInfo[];
  currentMatchCount?: number;
  totalMatchCount?: number;
}

export function encodeGameStateSync(message: GameStateSync): Uint8Array {
  let bb = popByteBuffer();
  _encodeGameStateSync(message, bb);
  return toUint8Array(bb);
}

function _encodeGameStateSync(message: GameStateSync, bb: ByteBuffer): void {
  // optional int32 currentActionSeat = 1;
  let $currentActionSeat = message.currentActionSeat;
  if ($currentActionSeat !== undefined) {
    writeVarint32(bb, 8);
    writeVarint64(bb, intToLong($currentActionSeat));
  }

  // repeated PlayerGameInfo players = 2;
  let array$players = message.players;
  if (array$players !== undefined) {
    for (let value of array$players) {
      writeVarint32(bb, 18);
      let nested = popByteBuffer();
      _encodePlayerGameInfo(value, nested);
      writeVarint32(bb, nested.limit);
      writeByteBuffer(bb, nested);
      pushByteBuffer(nested);
    }
  }

  // optional CardInfo lastDiscardedCard = 3;
  let $lastDiscardedCard = message.lastDiscardedCard;
  if ($lastDiscardedCard !== undefined) {
    writeVarint32(bb, 26);
    let nested = popByteBuffer();
    _encodeCardInfo($lastDiscardedCard, nested);
    writeVarint32(bb, nested.limit);
    writeByteBuffer(bb, nested);
    pushByteBuffer(nested);
  }

  // optional int32 remainingCardsCount = 4;
  let $remainingCardsCount = message.remainingCardsCount;
  if ($remainingCardsCount !== undefined) {
    writeVarint32(bb, 32);
    writeVarint64(bb, intToLong($remainingCardsCount));
  }

  // repeated CardInfo globalDiscardedCards = 5;
  let array$globalDiscardedCards = message.globalDiscardedCards;
  if (array$globalDiscardedCards !== undefined) {
    for (let value of array$globalDiscardedCards) {
      writeVarint32(bb, 42);
      let nested = popByteBuffer();
      _encodeCardInfo(value, nested);
      writeVarint32(bb, nested.limit);
      writeByteBuffer(bb, nested);
      pushByteBuffer(nested);
    }
  }

  // optional int32 currentMatchCount = 6;
  let $currentMatchCount = message.currentMatchCount;
  if ($currentMatchCount !== undefined) {
    writeVarint32(bb, 48);
    writeVarint64(bb, intToLong($currentMatchCount));
  }

  // optional int32 totalMatchCount = 7;
  let $totalMatchCount = message.totalMatchCount;
  if ($totalMatchCount !== undefined) {
    writeVarint32(bb, 56);
    writeVarint64(bb, intToLong($totalMatchCount));
  }
}

export function decodeGameStateSync(binary: Uint8Array): GameStateSync {
  return _decodeGameStateSync(wrapByteBuffer(binary));
}

function _decodeGameStateSync(bb: ByteBuffer): GameStateSync {
  let message: GameStateSync = {} as any;

  end_of_message: while (!isAtEnd(bb)) {
    let tag = readVarint32(bb);

    switch (tag >>> 3) {
      case 0:
        break end_of_message;

      // optional int32 currentActionSeat = 1;
      case 1: {
        message.currentActionSeat = readVarint32(bb);
        break;
      }

      // repeated PlayerGameInfo players = 2;
      case 2: {
        let limit = pushTemporaryLength(bb);
        let values = message.players || (message.players = []);
        values.push(_decodePlayerGameInfo(bb));
        bb.limit = limit;
        break;
      }

      // optional CardInfo lastDiscardedCard = 3;
      case 3: {
        let limit = pushTemporaryLength(bb);
        message.lastDiscardedCard = _decodeCardInfo(bb);
        bb.limit = limit;
        break;
      }

      // optional int32 remainingCardsCount = 4;
      case 4: {
        message.remainingCardsCount = readVarint32(bb);
        break;
      }

      // repeated CardInfo globalDiscardedCards = 5;
      case 5: {
        let limit = pushTemporaryLength(bb);
        let values = message.globalDiscardedCards || (message.globalDiscardedCards = []);
        values.push(_decodeCardInfo(bb));
        bb.limit = limit;
        break;
      }

      // optional int32 currentMatchCount = 6;
      case 6: {
        message.currentMatchCount = readVarint32(bb);
        break;
      }

      // optional int32 totalMatchCount = 7;
      case 7: {
        message.totalMatchCount = readVarint32(bb);
        break;
      }

      default:
        skipUnknownField(bb, tag & 7);
    }
  }

  return message;
}

export interface PlayerActionRequest {
  action?: ActionType;
  card?: CardInfo;
  fanNames?: string[];
  totalFan?: number;
  chiCards?: CardInfo[];
}

export function encodePlayerActionRequest(message: PlayerActionRequest): Uint8Array {
  let bb = popByteBuffer();
  _encodePlayerActionRequest(message, bb);
  return toUint8Array(bb);
}

function _encodePlayerActionRequest(message: PlayerActionRequest, bb: ByteBuffer): void {
  // optional ActionType action = 1;
  let $action = message.action;
  if ($action !== undefined) {
    writeVarint32(bb, 8);
    writeVarint32(bb, encodeActionType[$action]);
  }

  // optional CardInfo card = 2;
  let $card = message.card;
  if ($card !== undefined) {
    writeVarint32(bb, 18);
    let nested = popByteBuffer();
    _encodeCardInfo($card, nested);
    writeVarint32(bb, nested.limit);
    writeByteBuffer(bb, nested);
    pushByteBuffer(nested);
  }

  // repeated string fanNames = 3;
  let array$fanNames = message.fanNames;
  if (array$fanNames !== undefined) {
    for (let value of array$fanNames) {
      writeVarint32(bb, 26);
      writeString(bb, value);
    }
  }

  // optional int32 totalFan = 4;
  let $totalFan = message.totalFan;
  if ($totalFan !== undefined) {
    writeVarint32(bb, 32);
    writeVarint64(bb, intToLong($totalFan));
  }

  // repeated CardInfo chiCards = 5;
  let array$chiCards = message.chiCards;
  if (array$chiCards !== undefined) {
    for (let value of array$chiCards) {
      writeVarint32(bb, 42);
      let nested = popByteBuffer();
      _encodeCardInfo(value, nested);
      writeVarint32(bb, nested.limit);
      writeByteBuffer(bb, nested);
      pushByteBuffer(nested);
    }
  }
}

export function decodePlayerActionRequest(binary: Uint8Array): PlayerActionRequest {
  return _decodePlayerActionRequest(wrapByteBuffer(binary));
}

function _decodePlayerActionRequest(bb: ByteBuffer): PlayerActionRequest {
  let message: PlayerActionRequest = {} as any;

  end_of_message: while (!isAtEnd(bb)) {
    let tag = readVarint32(bb);

    switch (tag >>> 3) {
      case 0:
        break end_of_message;

      // optional ActionType action = 1;
      case 1: {
        message.action = decodeActionType[readVarint32(bb)];
        break;
      }

      // optional CardInfo card = 2;
      case 2: {
        let limit = pushTemporaryLength(bb);
        message.card = _decodeCardInfo(bb);
        bb.limit = limit;
        break;
      }

      // repeated string fanNames = 3;
      case 3: {
        let values = message.fanNames || (message.fanNames = []);
        values.push(readString(bb, readVarint32(bb)));
        break;
      }

      // optional int32 totalFan = 4;
      case 4: {
        message.totalFan = readVarint32(bb);
        break;
      }

      // repeated CardInfo chiCards = 5;
      case 5: {
        let limit = pushTemporaryLength(bb);
        let values = message.chiCards || (message.chiCards = []);
        values.push(_decodeCardInfo(bb));
        bb.limit = limit;
        break;
      }

      default:
        skipUnknownField(bb, tag & 7);
    }
  }

  return message;
}

export interface FinalResult {
  winnerNickname?: string;
  winningScore?: number;
  endReason?: string;
  leaderBoard?: PlayerFinalInfo[];
}

export function encodeFinalResult(message: FinalResult): Uint8Array {
  let bb = popByteBuffer();
  _encodeFinalResult(message, bb);
  return toUint8Array(bb);
}

function _encodeFinalResult(message: FinalResult, bb: ByteBuffer): void {
  // optional string winnerNickname = 1;
  let $winnerNickname = message.winnerNickname;
  if ($winnerNickname !== undefined) {
    writeVarint32(bb, 10);
    writeString(bb, $winnerNickname);
  }

  // optional int32 winningScore = 2;
  let $winningScore = message.winningScore;
  if ($winningScore !== undefined) {
    writeVarint32(bb, 16);
    writeVarint64(bb, intToLong($winningScore));
  }

  // optional string endReason = 3;
  let $endReason = message.endReason;
  if ($endReason !== undefined) {
    writeVarint32(bb, 26);
    writeString(bb, $endReason);
  }

  // repeated PlayerFinalInfo leaderBoard = 4;
  let array$leaderBoard = message.leaderBoard;
  if (array$leaderBoard !== undefined) {
    for (let value of array$leaderBoard) {
      writeVarint32(bb, 34);
      let nested = popByteBuffer();
      _encodePlayerFinalInfo(value, nested);
      writeVarint32(bb, nested.limit);
      writeByteBuffer(bb, nested);
      pushByteBuffer(nested);
    }
  }
}

export function decodeFinalResult(binary: Uint8Array): FinalResult {
  return _decodeFinalResult(wrapByteBuffer(binary));
}

function _decodeFinalResult(bb: ByteBuffer): FinalResult {
  let message: FinalResult = {} as any;

  end_of_message: while (!isAtEnd(bb)) {
    let tag = readVarint32(bb);

    switch (tag >>> 3) {
      case 0:
        break end_of_message;

      // optional string winnerNickname = 1;
      case 1: {
        message.winnerNickname = readString(bb, readVarint32(bb));
        break;
      }

      // optional int32 winningScore = 2;
      case 2: {
        message.winningScore = readVarint32(bb);
        break;
      }

      // optional string endReason = 3;
      case 3: {
        message.endReason = readString(bb, readVarint32(bb));
        break;
      }

      // repeated PlayerFinalInfo leaderBoard = 4;
      case 4: {
        let limit = pushTemporaryLength(bb);
        let values = message.leaderBoard || (message.leaderBoard = []);
        values.push(_decodePlayerFinalInfo(bb));
        bb.limit = limit;
        break;
      }

      default:
        skipUnknownField(bb, tag & 7);
    }
  }

  return message;
}

export interface PlayerFinalInfo {
  nickname?: string;
  totalScore?: number;
  seatIndex?: number;
  rank?: number;
}

export function encodePlayerFinalInfo(message: PlayerFinalInfo): Uint8Array {
  let bb = popByteBuffer();
  _encodePlayerFinalInfo(message, bb);
  return toUint8Array(bb);
}

function _encodePlayerFinalInfo(message: PlayerFinalInfo, bb: ByteBuffer): void {
  // optional string nickname = 1;
  let $nickname = message.nickname;
  if ($nickname !== undefined) {
    writeVarint32(bb, 10);
    writeString(bb, $nickname);
  }

  // optional int32 totalScore = 2;
  let $totalScore = message.totalScore;
  if ($totalScore !== undefined) {
    writeVarint32(bb, 16);
    writeVarint64(bb, intToLong($totalScore));
  }

  // optional int32 seatIndex = 3;
  let $seatIndex = message.seatIndex;
  if ($seatIndex !== undefined) {
    writeVarint32(bb, 24);
    writeVarint64(bb, intToLong($seatIndex));
  }

  // optional int32 rank = 4;
  let $rank = message.rank;
  if ($rank !== undefined) {
    writeVarint32(bb, 32);
    writeVarint64(bb, intToLong($rank));
  }
}

export function decodePlayerFinalInfo(binary: Uint8Array): PlayerFinalInfo {
  return _decodePlayerFinalInfo(wrapByteBuffer(binary));
}

function _decodePlayerFinalInfo(bb: ByteBuffer): PlayerFinalInfo {
  let message: PlayerFinalInfo = {} as any;

  end_of_message: while (!isAtEnd(bb)) {
    let tag = readVarint32(bb);

    switch (tag >>> 3) {
      case 0:
        break end_of_message;

      // optional string nickname = 1;
      case 1: {
        message.nickname = readString(bb, readVarint32(bb));
        break;
      }

      // optional int32 totalScore = 2;
      case 2: {
        message.totalScore = readVarint32(bb);
        break;
      }

      // optional int32 seatIndex = 3;
      case 3: {
        message.seatIndex = readVarint32(bb);
        break;
      }

      // optional int32 rank = 4;
      case 4: {
        message.rank = readVarint32(bb);
        break;
      }

      default:
        skipUnknownField(bb, tag & 7);
    }
  }

  return message;
}

export interface PlayerRoundScore {
  seatIndex?: number;
  nickname?: string;
  scoreChange?: number;
  currentTotalScore?: number;
}

export function encodePlayerRoundScore(message: PlayerRoundScore): Uint8Array {
  let bb = popByteBuffer();
  _encodePlayerRoundScore(message, bb);
  return toUint8Array(bb);
}

function _encodePlayerRoundScore(message: PlayerRoundScore, bb: ByteBuffer): void {
  // optional int32 seatIndex = 1;
  let $seatIndex = message.seatIndex;
  if ($seatIndex !== undefined) {
    writeVarint32(bb, 8);
    writeVarint64(bb, intToLong($seatIndex));
  }

  // optional string nickname = 2;
  let $nickname = message.nickname;
  if ($nickname !== undefined) {
    writeVarint32(bb, 18);
    writeString(bb, $nickname);
  }

  // optional int32 scoreChange = 3;
  let $scoreChange = message.scoreChange;
  if ($scoreChange !== undefined) {
    writeVarint32(bb, 24);
    writeVarint64(bb, intToLong($scoreChange));
  }

  // optional int32 currentTotalScore = 4;
  let $currentTotalScore = message.currentTotalScore;
  if ($currentTotalScore !== undefined) {
    writeVarint32(bb, 32);
    writeVarint64(bb, intToLong($currentTotalScore));
  }
}

export function decodePlayerRoundScore(binary: Uint8Array): PlayerRoundScore {
  return _decodePlayerRoundScore(wrapByteBuffer(binary));
}

function _decodePlayerRoundScore(bb: ByteBuffer): PlayerRoundScore {
  let message: PlayerRoundScore = {} as any;

  end_of_message: while (!isAtEnd(bb)) {
    let tag = readVarint32(bb);

    switch (tag >>> 3) {
      case 0:
        break end_of_message;

      // optional int32 seatIndex = 1;
      case 1: {
        message.seatIndex = readVarint32(bb);
        break;
      }

      // optional string nickname = 2;
      case 2: {
        message.nickname = readString(bb, readVarint32(bb));
        break;
      }

      // optional int32 scoreChange = 3;
      case 3: {
        message.scoreChange = readVarint32(bb);
        break;
      }

      // optional int32 currentTotalScore = 4;
      case 4: {
        message.currentTotalScore = readVarint32(bb);
        break;
      }

      default:
        skipUnknownField(bb, tag & 7);
    }
  }

  return message;
}

export interface WinnerDetail {
  seatIndex?: number;
  winType?: string;
  melds?: CardSet[];
  handCards?: CardInfo[];
  winningCard?: CardInfo;
  fanNames?: string[];
  totalFan?: number;
}

export function encodeWinnerDetail(message: WinnerDetail): Uint8Array {
  let bb = popByteBuffer();
  _encodeWinnerDetail(message, bb);
  return toUint8Array(bb);
}

function _encodeWinnerDetail(message: WinnerDetail, bb: ByteBuffer): void {
  // optional int32 seatIndex = 1;
  let $seatIndex = message.seatIndex;
  if ($seatIndex !== undefined) {
    writeVarint32(bb, 8);
    writeVarint64(bb, intToLong($seatIndex));
  }

  // optional string winType = 2;
  let $winType = message.winType;
  if ($winType !== undefined) {
    writeVarint32(bb, 18);
    writeString(bb, $winType);
  }

  // repeated CardSet melds = 3;
  let array$melds = message.melds;
  if (array$melds !== undefined) {
    for (let value of array$melds) {
      writeVarint32(bb, 26);
      let nested = popByteBuffer();
      _encodeCardSet(value, nested);
      writeVarint32(bb, nested.limit);
      writeByteBuffer(bb, nested);
      pushByteBuffer(nested);
    }
  }

  // repeated CardInfo handCards = 4;
  let array$handCards = message.handCards;
  if (array$handCards !== undefined) {
    for (let value of array$handCards) {
      writeVarint32(bb, 34);
      let nested = popByteBuffer();
      _encodeCardInfo(value, nested);
      writeVarint32(bb, nested.limit);
      writeByteBuffer(bb, nested);
      pushByteBuffer(nested);
    }
  }

  // optional CardInfo winningCard = 5;
  let $winningCard = message.winningCard;
  if ($winningCard !== undefined) {
    writeVarint32(bb, 42);
    let nested = popByteBuffer();
    _encodeCardInfo($winningCard, nested);
    writeVarint32(bb, nested.limit);
    writeByteBuffer(bb, nested);
    pushByteBuffer(nested);
  }

  // repeated string fanNames = 6;
  let array$fanNames = message.fanNames;
  if (array$fanNames !== undefined) {
    for (let value of array$fanNames) {
      writeVarint32(bb, 50);
      writeString(bb, value);
    }
  }

  // optional int32 totalFan = 7;
  let $totalFan = message.totalFan;
  if ($totalFan !== undefined) {
    writeVarint32(bb, 56);
    writeVarint64(bb, intToLong($totalFan));
  }
}

export function decodeWinnerDetail(binary: Uint8Array): WinnerDetail {
  return _decodeWinnerDetail(wrapByteBuffer(binary));
}

function _decodeWinnerDetail(bb: ByteBuffer): WinnerDetail {
  let message: WinnerDetail = {} as any;

  end_of_message: while (!isAtEnd(bb)) {
    let tag = readVarint32(bb);

    switch (tag >>> 3) {
      case 0:
        break end_of_message;

      // optional int32 seatIndex = 1;
      case 1: {
        message.seatIndex = readVarint32(bb);
        break;
      }

      // optional string winType = 2;
      case 2: {
        message.winType = readString(bb, readVarint32(bb));
        break;
      }

      // repeated CardSet melds = 3;
      case 3: {
        let limit = pushTemporaryLength(bb);
        let values = message.melds || (message.melds = []);
        values.push(_decodeCardSet(bb));
        bb.limit = limit;
        break;
      }

      // repeated CardInfo handCards = 4;
      case 4: {
        let limit = pushTemporaryLength(bb);
        let values = message.handCards || (message.handCards = []);
        values.push(_decodeCardInfo(bb));
        bb.limit = limit;
        break;
      }

      // optional CardInfo winningCard = 5;
      case 5: {
        let limit = pushTemporaryLength(bb);
        message.winningCard = _decodeCardInfo(bb);
        bb.limit = limit;
        break;
      }

      // repeated string fanNames = 6;
      case 6: {
        let values = message.fanNames || (message.fanNames = []);
        values.push(readString(bb, readVarint32(bb)));
        break;
      }

      // optional int32 totalFan = 7;
      case 7: {
        message.totalFan = readVarint32(bb);
        break;
      }

      default:
        skipUnknownField(bb, tag & 7);
    }
  }

  return message;
}

export interface RoundSummary {
  winners?: WinnerDetail[];
  scores?: PlayerRoundScore[];
}

export function encodeRoundSummary(message: RoundSummary): Uint8Array {
  let bb = popByteBuffer();
  _encodeRoundSummary(message, bb);
  return toUint8Array(bb);
}

function _encodeRoundSummary(message: RoundSummary, bb: ByteBuffer): void {
  // repeated WinnerDetail winners = 1;
  let array$winners = message.winners;
  if (array$winners !== undefined) {
    for (let value of array$winners) {
      writeVarint32(bb, 10);
      let nested = popByteBuffer();
      _encodeWinnerDetail(value, nested);
      writeVarint32(bb, nested.limit);
      writeByteBuffer(bb, nested);
      pushByteBuffer(nested);
    }
  }

  // repeated PlayerRoundScore scores = 2;
  let array$scores = message.scores;
  if (array$scores !== undefined) {
    for (let value of array$scores) {
      writeVarint32(bb, 18);
      let nested = popByteBuffer();
      _encodePlayerRoundScore(value, nested);
      writeVarint32(bb, nested.limit);
      writeByteBuffer(bb, nested);
      pushByteBuffer(nested);
    }
  }
}

export function decodeRoundSummary(binary: Uint8Array): RoundSummary {
  return _decodeRoundSummary(wrapByteBuffer(binary));
}

function _decodeRoundSummary(bb: ByteBuffer): RoundSummary {
  let message: RoundSummary = {} as any;

  end_of_message: while (!isAtEnd(bb)) {
    let tag = readVarint32(bb);

    switch (tag >>> 3) {
      case 0:
        break end_of_message;

      // repeated WinnerDetail winners = 1;
      case 1: {
        let limit = pushTemporaryLength(bb);
        let values = message.winners || (message.winners = []);
        values.push(_decodeWinnerDetail(bb));
        bb.limit = limit;
        break;
      }

      // repeated PlayerRoundScore scores = 2;
      case 2: {
        let limit = pushTemporaryLength(bb);
        let values = message.scores || (message.scores = []);
        values.push(_decodePlayerRoundScore(bb));
        bb.limit = limit;
        break;
      }

      default:
        skipUnknownField(bb, tag & 7);
    }
  }

  return message;
}

export interface ReadyNextMatchRequest {
  isReady?: boolean;
}

export function encodeReadyNextMatchRequest(message: ReadyNextMatchRequest): Uint8Array {
  let bb = popByteBuffer();
  _encodeReadyNextMatchRequest(message, bb);
  return toUint8Array(bb);
}

function _encodeReadyNextMatchRequest(message: ReadyNextMatchRequest, bb: ByteBuffer): void {
  // optional bool isReady = 1;
  let $isReady = message.isReady;
  if ($isReady !== undefined) {
    writeVarint32(bb, 8);
    writeByte(bb, $isReady ? 1 : 0);
  }
}

export function decodeReadyNextMatchRequest(binary: Uint8Array): ReadyNextMatchRequest {
  return _decodeReadyNextMatchRequest(wrapByteBuffer(binary));
}

function _decodeReadyNextMatchRequest(bb: ByteBuffer): ReadyNextMatchRequest {
  let message: ReadyNextMatchRequest = {} as any;

  end_of_message: while (!isAtEnd(bb)) {
    let tag = readVarint32(bb);

    switch (tag >>> 3) {
      case 0:
        break end_of_message;

      // optional bool isReady = 1;
      case 1: {
        message.isReady = !!readByte(bb);
        break;
      }

      default:
        skipUnknownField(bb, tag & 7);
    }
  }

  return message;
}

export interface MainMessage {
  code?: number;
  loginRequest?: LoginRequest;
  loginResponse?: LoginResponse;
  playerList?: PlayerList;
  gameState?: GameStateSync;
  actionReq?: PlayerActionRequest;
  finalResult?: FinalResult;
  roundSummary?: RoundSummary;
  readyReq?: ReadyNextMatchRequest;
}

export function encodeMainMessage(message: MainMessage): Uint8Array {
  let bb = popByteBuffer();
  _encodeMainMessage(message, bb);
  return toUint8Array(bb);
}

function _encodeMainMessage(message: MainMessage, bb: ByteBuffer): void {
  // optional int32 code = 1;
  let $code = message.code;
  if ($code !== undefined) {
    writeVarint32(bb, 8);
    writeVarint64(bb, intToLong($code));
  }

  // optional LoginRequest loginRequest = 2;
  let $loginRequest = message.loginRequest;
  if ($loginRequest !== undefined) {
    writeVarint32(bb, 18);
    let nested = popByteBuffer();
    _encodeLoginRequest($loginRequest, nested);
    writeVarint32(bb, nested.limit);
    writeByteBuffer(bb, nested);
    pushByteBuffer(nested);
  }

  // optional LoginResponse loginResponse = 3;
  let $loginResponse = message.loginResponse;
  if ($loginResponse !== undefined) {
    writeVarint32(bb, 26);
    let nested = popByteBuffer();
    _encodeLoginResponse($loginResponse, nested);
    writeVarint32(bb, nested.limit);
    writeByteBuffer(bb, nested);
    pushByteBuffer(nested);
  }

  // optional PlayerList playerList = 4;
  let $playerList = message.playerList;
  if ($playerList !== undefined) {
    writeVarint32(bb, 34);
    let nested = popByteBuffer();
    _encodePlayerList($playerList, nested);
    writeVarint32(bb, nested.limit);
    writeByteBuffer(bb, nested);
    pushByteBuffer(nested);
  }

  // optional GameStateSync gameState = 5;
  let $gameState = message.gameState;
  if ($gameState !== undefined) {
    writeVarint32(bb, 42);
    let nested = popByteBuffer();
    _encodeGameStateSync($gameState, nested);
    writeVarint32(bb, nested.limit);
    writeByteBuffer(bb, nested);
    pushByteBuffer(nested);
  }

  // optional PlayerActionRequest actionReq = 6;
  let $actionReq = message.actionReq;
  if ($actionReq !== undefined) {
    writeVarint32(bb, 50);
    let nested = popByteBuffer();
    _encodePlayerActionRequest($actionReq, nested);
    writeVarint32(bb, nested.limit);
    writeByteBuffer(bb, nested);
    pushByteBuffer(nested);
  }

  // optional FinalResult finalResult = 7;
  let $finalResult = message.finalResult;
  if ($finalResult !== undefined) {
    writeVarint32(bb, 58);
    let nested = popByteBuffer();
    _encodeFinalResult($finalResult, nested);
    writeVarint32(bb, nested.limit);
    writeByteBuffer(bb, nested);
    pushByteBuffer(nested);
  }

  // optional RoundSummary roundSummary = 8;
  let $roundSummary = message.roundSummary;
  if ($roundSummary !== undefined) {
    writeVarint32(bb, 66);
    let nested = popByteBuffer();
    _encodeRoundSummary($roundSummary, nested);
    writeVarint32(bb, nested.limit);
    writeByteBuffer(bb, nested);
    pushByteBuffer(nested);
  }

  // optional ReadyNextMatchRequest readyReq = 9;
  let $readyReq = message.readyReq;
  if ($readyReq !== undefined) {
    writeVarint32(bb, 74);
    let nested = popByteBuffer();
    _encodeReadyNextMatchRequest($readyReq, nested);
    writeVarint32(bb, nested.limit);
    writeByteBuffer(bb, nested);
    pushByteBuffer(nested);
  }
}

export function decodeMainMessage(binary: Uint8Array): MainMessage {
  return _decodeMainMessage(wrapByteBuffer(binary));
}

function _decodeMainMessage(bb: ByteBuffer): MainMessage {
  let message: MainMessage = {} as any;

  end_of_message: while (!isAtEnd(bb)) {
    let tag = readVarint32(bb);

    switch (tag >>> 3) {
      case 0:
        break end_of_message;

      // optional int32 code = 1;
      case 1: {
        message.code = readVarint32(bb);
        break;
      }

      // optional LoginRequest loginRequest = 2;
      case 2: {
        let limit = pushTemporaryLength(bb);
        message.loginRequest = _decodeLoginRequest(bb);
        bb.limit = limit;
        break;
      }

      // optional LoginResponse loginResponse = 3;
      case 3: {
        let limit = pushTemporaryLength(bb);
        message.loginResponse = _decodeLoginResponse(bb);
        bb.limit = limit;
        break;
      }

      // optional PlayerList playerList = 4;
      case 4: {
        let limit = pushTemporaryLength(bb);
        message.playerList = _decodePlayerList(bb);
        bb.limit = limit;
        break;
      }

      // optional GameStateSync gameState = 5;
      case 5: {
        let limit = pushTemporaryLength(bb);
        message.gameState = _decodeGameStateSync(bb);
        bb.limit = limit;
        break;
      }

      // optional PlayerActionRequest actionReq = 6;
      case 6: {
        let limit = pushTemporaryLength(bb);
        message.actionReq = _decodePlayerActionRequest(bb);
        bb.limit = limit;
        break;
      }

      // optional FinalResult finalResult = 7;
      case 7: {
        let limit = pushTemporaryLength(bb);
        message.finalResult = _decodeFinalResult(bb);
        bb.limit = limit;
        break;
      }

      // optional RoundSummary roundSummary = 8;
      case 8: {
        let limit = pushTemporaryLength(bb);
        message.roundSummary = _decodeRoundSummary(bb);
        bb.limit = limit;
        break;
      }

      // optional ReadyNextMatchRequest readyReq = 9;
      case 9: {
        let limit = pushTemporaryLength(bb);
        message.readyReq = _decodeReadyNextMatchRequest(bb);
        bb.limit = limit;
        break;
      }

      default:
        skipUnknownField(bb, tag & 7);
    }
  }

  return message;
}

export interface Long {
  low: number;
  high: number;
  unsigned: boolean;
}

interface ByteBuffer {
  bytes: Uint8Array;
  offset: number;
  limit: number;
}

function pushTemporaryLength(bb: ByteBuffer): number {
  let length = readVarint32(bb);
  let limit = bb.limit;
  bb.limit = bb.offset + length;
  return limit;
}

function skipUnknownField(bb: ByteBuffer, type: number): void {
  switch (type) {
    case 0: while (readByte(bb) & 0x80) { } break;
    case 2: skip(bb, readVarint32(bb)); break;
    case 5: skip(bb, 4); break;
    case 1: skip(bb, 8); break;
    default: throw new Error("Unimplemented type: " + type);
  }
}

function stringToLong(value: string): Long {
  return {
    low: value.charCodeAt(0) | (value.charCodeAt(1) << 16),
    high: value.charCodeAt(2) | (value.charCodeAt(3) << 16),
    unsigned: false,
  };
}

function longToString(value: Long): string {
  let low = value.low;
  let high = value.high;
  return String.fromCharCode(
    low & 0xFFFF,
    low >>> 16,
    high & 0xFFFF,
    high >>> 16);
}

// The code below was modified from https://github.com/protobufjs/bytebuffer.js
// which is under the Apache License 2.0.

let f32 = new Float32Array(1);
let f32_u8 = new Uint8Array(f32.buffer);

let f64 = new Float64Array(1);
let f64_u8 = new Uint8Array(f64.buffer);

function intToLong(value: number): Long {
  value |= 0;
  return {
    low: value,
    high: value >> 31,
    unsigned: value >= 0,
  };
}

let bbStack: ByteBuffer[] = [];

function popByteBuffer(): ByteBuffer {
  const bb = bbStack.pop();
  if (!bb) return { bytes: new Uint8Array(64), offset: 0, limit: 0 };
  bb.offset = bb.limit = 0;
  return bb;
}

function pushByteBuffer(bb: ByteBuffer): void {
  bbStack.push(bb);
}

function wrapByteBuffer(bytes: Uint8Array): ByteBuffer {
  return { bytes, offset: 0, limit: bytes.length };
}

function toUint8Array(bb: ByteBuffer): Uint8Array {
  let bytes = bb.bytes;
  let limit = bb.limit;
  return bytes.length === limit ? bytes : bytes.subarray(0, limit);
}

function skip(bb: ByteBuffer, offset: number): void {
  if (bb.offset + offset > bb.limit) {
    throw new Error('Skip past limit');
  }
  bb.offset += offset;
}

function isAtEnd(bb: ByteBuffer): boolean {
  return bb.offset >= bb.limit;
}

function grow(bb: ByteBuffer, count: number): number {
  let bytes = bb.bytes;
  let offset = bb.offset;
  let limit = bb.limit;
  let finalOffset = offset + count;
  if (finalOffset > bytes.length) {
    let newBytes = new Uint8Array(finalOffset * 2);
    newBytes.set(bytes);
    bb.bytes = newBytes;
  }
  bb.offset = finalOffset;
  if (finalOffset > limit) {
    bb.limit = finalOffset;
  }
  return offset;
}

function advance(bb: ByteBuffer, count: number): number {
  let offset = bb.offset;
  if (offset + count > bb.limit) {
    throw new Error('Read past limit');
  }
  bb.offset += count;
  return offset;
}

function readBytes(bb: ByteBuffer, count: number): Uint8Array {
  let offset = advance(bb, count);
  return bb.bytes.subarray(offset, offset + count);
}

function writeBytes(bb: ByteBuffer, buffer: Uint8Array): void {
  let offset = grow(bb, buffer.length);
  bb.bytes.set(buffer, offset);
}

function readString(bb: ByteBuffer, count: number): string {
  // Sadly a hand-coded UTF8 decoder is much faster than subarray+TextDecoder in V8
  let offset = advance(bb, count);
  let fromCharCode = String.fromCharCode;
  let bytes = bb.bytes;
  let invalid = '\uFFFD';
  let text = '';

  for (let i = 0; i < count; i++) {
    let c1 = bytes[i + offset], c2: number, c3: number, c4: number, c: number;

    // 1 byte
    if ((c1 & 0x80) === 0) {
      text += fromCharCode(c1);
    }

    // 2 bytes
    else if ((c1 & 0xE0) === 0xC0) {
      if (i + 1 >= count) text += invalid;
      else {
        c2 = bytes[i + offset + 1];
        if ((c2 & 0xC0) !== 0x80) text += invalid;
        else {
          c = ((c1 & 0x1F) << 6) | (c2 & 0x3F);
          if (c < 0x80) text += invalid;
          else {
            text += fromCharCode(c);
            i++;
          }
        }
      }
    }

    // 3 bytes
    else if ((c1 & 0xF0) == 0xE0) {
      if (i + 2 >= count) text += invalid;
      else {
        c2 = bytes[i + offset + 1];
        c3 = bytes[i + offset + 2];
        if (((c2 | (c3 << 8)) & 0xC0C0) !== 0x8080) text += invalid;
        else {
          c = ((c1 & 0x0F) << 12) | ((c2 & 0x3F) << 6) | (c3 & 0x3F);
          if (c < 0x0800 || (c >= 0xD800 && c <= 0xDFFF)) text += invalid;
          else {
            text += fromCharCode(c);
            i += 2;
          }
        }
      }
    }

    // 4 bytes
    else if ((c1 & 0xF8) == 0xF0) {
      if (i + 3 >= count) text += invalid;
      else {
        c2 = bytes[i + offset + 1];
        c3 = bytes[i + offset + 2];
        c4 = bytes[i + offset + 3];
        if (((c2 | (c3 << 8) | (c4 << 16)) & 0xC0C0C0) !== 0x808080) text += invalid;
        else {
          c = ((c1 & 0x07) << 0x12) | ((c2 & 0x3F) << 0x0C) | ((c3 & 0x3F) << 0x06) | (c4 & 0x3F);
          if (c < 0x10000 || c > 0x10FFFF) text += invalid;
          else {
            c -= 0x10000;
            text += fromCharCode((c >> 10) + 0xD800, (c & 0x3FF) + 0xDC00);
            i += 3;
          }
        }
      }
    }

    else text += invalid;
  }

  return text;
}

function writeString(bb: ByteBuffer, text: string): void {
  // Sadly a hand-coded UTF8 encoder is much faster than TextEncoder+set in V8
  let n = text.length;
  let byteCount = 0;

  // Write the byte count first
  for (let i = 0; i < n; i++) {
    let c = text.charCodeAt(i);
    if (c >= 0xD800 && c <= 0xDBFF && i + 1 < n) {
      c = (c << 10) + text.charCodeAt(++i) - 0x35FDC00;
    }
    byteCount += c < 0x80 ? 1 : c < 0x800 ? 2 : c < 0x10000 ? 3 : 4;
  }
  writeVarint32(bb, byteCount);

  let offset = grow(bb, byteCount);
  let bytes = bb.bytes;

  // Then write the bytes
  for (let i = 0; i < n; i++) {
    let c = text.charCodeAt(i);
    if (c >= 0xD800 && c <= 0xDBFF && i + 1 < n) {
      c = (c << 10) + text.charCodeAt(++i) - 0x35FDC00;
    }
    if (c < 0x80) {
      bytes[offset++] = c;
    } else {
      if (c < 0x800) {
        bytes[offset++] = ((c >> 6) & 0x1F) | 0xC0;
      } else {
        if (c < 0x10000) {
          bytes[offset++] = ((c >> 12) & 0x0F) | 0xE0;
        } else {
          bytes[offset++] = ((c >> 18) & 0x07) | 0xF0;
          bytes[offset++] = ((c >> 12) & 0x3F) | 0x80;
        }
        bytes[offset++] = ((c >> 6) & 0x3F) | 0x80;
      }
      bytes[offset++] = (c & 0x3F) | 0x80;
    }
  }
}

function writeByteBuffer(bb: ByteBuffer, buffer: ByteBuffer): void {
  let offset = grow(bb, buffer.limit);
  let from = bb.bytes;
  let to = buffer.bytes;

  // This for loop is much faster than subarray+set on V8
  for (let i = 0, n = buffer.limit; i < n; i++) {
    from[i + offset] = to[i];
  }
}

function readByte(bb: ByteBuffer): number {
  return bb.bytes[advance(bb, 1)];
}

function writeByte(bb: ByteBuffer, value: number): void {
  let offset = grow(bb, 1);
  bb.bytes[offset] = value;
}

function readFloat(bb: ByteBuffer): number {
  let offset = advance(bb, 4);
  let bytes = bb.bytes;

  // Manual copying is much faster than subarray+set in V8
  f32_u8[0] = bytes[offset++];
  f32_u8[1] = bytes[offset++];
  f32_u8[2] = bytes[offset++];
  f32_u8[3] = bytes[offset++];
  return f32[0];
}

function writeFloat(bb: ByteBuffer, value: number): void {
  let offset = grow(bb, 4);
  let bytes = bb.bytes;
  f32[0] = value;

  // Manual copying is much faster than subarray+set in V8
  bytes[offset++] = f32_u8[0];
  bytes[offset++] = f32_u8[1];
  bytes[offset++] = f32_u8[2];
  bytes[offset++] = f32_u8[3];
}

function readDouble(bb: ByteBuffer): number {
  let offset = advance(bb, 8);
  let bytes = bb.bytes;

  // Manual copying is much faster than subarray+set in V8
  f64_u8[0] = bytes[offset++];
  f64_u8[1] = bytes[offset++];
  f64_u8[2] = bytes[offset++];
  f64_u8[3] = bytes[offset++];
  f64_u8[4] = bytes[offset++];
  f64_u8[5] = bytes[offset++];
  f64_u8[6] = bytes[offset++];
  f64_u8[7] = bytes[offset++];
  return f64[0];
}

function writeDouble(bb: ByteBuffer, value: number): void {
  let offset = grow(bb, 8);
  let bytes = bb.bytes;
  f64[0] = value;

  // Manual copying is much faster than subarray+set in V8
  bytes[offset++] = f64_u8[0];
  bytes[offset++] = f64_u8[1];
  bytes[offset++] = f64_u8[2];
  bytes[offset++] = f64_u8[3];
  bytes[offset++] = f64_u8[4];
  bytes[offset++] = f64_u8[5];
  bytes[offset++] = f64_u8[6];
  bytes[offset++] = f64_u8[7];
}

function readInt32(bb: ByteBuffer): number {
  let offset = advance(bb, 4);
  let bytes = bb.bytes;
  return (
    bytes[offset] |
    (bytes[offset + 1] << 8) |
    (bytes[offset + 2] << 16) |
    (bytes[offset + 3] << 24)
  );
}

function writeInt32(bb: ByteBuffer, value: number): void {
  let offset = grow(bb, 4);
  let bytes = bb.bytes;
  bytes[offset] = value;
  bytes[offset + 1] = value >> 8;
  bytes[offset + 2] = value >> 16;
  bytes[offset + 3] = value >> 24;
}

function readInt64(bb: ByteBuffer, unsigned: boolean): Long {
  return {
    low: readInt32(bb),
    high: readInt32(bb),
    unsigned,
  };
}

function writeInt64(bb: ByteBuffer, value: Long): void {
  writeInt32(bb, value.low);
  writeInt32(bb, value.high);
}

function readVarint32(bb: ByteBuffer): number {
  let c = 0;
  let value = 0;
  let b: number;
  do {
    b = readByte(bb);
    if (c < 32) value |= (b & 0x7F) << c;
    c += 7;
  } while (b & 0x80);
  return value;
}

function writeVarint32(bb: ByteBuffer, value: number): void {
  value >>>= 0;
  while (value >= 0x80) {
    writeByte(bb, (value & 0x7f) | 0x80);
    value >>>= 7;
  }
  writeByte(bb, value);
}

function readVarint64(bb: ByteBuffer, unsigned: boolean): Long {
  let part0 = 0;
  let part1 = 0;
  let part2 = 0;
  let b: number;

  b = readByte(bb); part0 = (b & 0x7F); if (b & 0x80) {
    b = readByte(bb); part0 |= (b & 0x7F) << 7; if (b & 0x80) {
      b = readByte(bb); part0 |= (b & 0x7F) << 14; if (b & 0x80) {
        b = readByte(bb); part0 |= (b & 0x7F) << 21; if (b & 0x80) {

          b = readByte(bb); part1 = (b & 0x7F); if (b & 0x80) {
            b = readByte(bb); part1 |= (b & 0x7F) << 7; if (b & 0x80) {
              b = readByte(bb); part1 |= (b & 0x7F) << 14; if (b & 0x80) {
                b = readByte(bb); part1 |= (b & 0x7F) << 21; if (b & 0x80) {

                  b = readByte(bb); part2 = (b & 0x7F); if (b & 0x80) {
                    b = readByte(bb); part2 |= (b & 0x7F) << 7;
                  }
                }
              }
            }
          }
        }
      }
    }
  }

  return {
    low: part0 | (part1 << 28),
    high: (part1 >>> 4) | (part2 << 24),
    unsigned,
  };
}

function writeVarint64(bb: ByteBuffer, value: Long): void {
  let part0 = value.low >>> 0;
  let part1 = ((value.low >>> 28) | (value.high << 4)) >>> 0;
  let part2 = value.high >>> 24;

  // ref: src/google/protobuf/io/coded_stream.cc
  let size =
    part2 === 0 ?
      part1 === 0 ?
        part0 < 1 << 14 ?
          part0 < 1 << 7 ? 1 : 2 :
          part0 < 1 << 21 ? 3 : 4 :
        part1 < 1 << 14 ?
          part1 < 1 << 7 ? 5 : 6 :
          part1 < 1 << 21 ? 7 : 8 :
      part2 < 1 << 7 ? 9 : 10;

  let offset = grow(bb, size);
  let bytes = bb.bytes;

  switch (size) {
    case 10: bytes[offset + 9] = (part2 >>> 7) & 0x01;
    case 9: bytes[offset + 8] = size !== 9 ? part2 | 0x80 : part2 & 0x7F;
    case 8: bytes[offset + 7] = size !== 8 ? (part1 >>> 21) | 0x80 : (part1 >>> 21) & 0x7F;
    case 7: bytes[offset + 6] = size !== 7 ? (part1 >>> 14) | 0x80 : (part1 >>> 14) & 0x7F;
    case 6: bytes[offset + 5] = size !== 6 ? (part1 >>> 7) | 0x80 : (part1 >>> 7) & 0x7F;
    case 5: bytes[offset + 4] = size !== 5 ? part1 | 0x80 : part1 & 0x7F;
    case 4: bytes[offset + 3] = size !== 4 ? (part0 >>> 21) | 0x80 : (part0 >>> 21) & 0x7F;
    case 3: bytes[offset + 2] = size !== 3 ? (part0 >>> 14) | 0x80 : (part0 >>> 14) & 0x7F;
    case 2: bytes[offset + 1] = size !== 2 ? (part0 >>> 7) | 0x80 : (part0 >>> 7) & 0x7F;
    case 1: bytes[offset] = size !== 1 ? part0 | 0x80 : part0 & 0x7F;
  }
}

function readVarint32ZigZag(bb: ByteBuffer): number {
  let value = readVarint32(bb);

  // ref: src/google/protobuf/wire_format_lite.h
  return (value >>> 1) ^ -(value & 1);
}

function writeVarint32ZigZag(bb: ByteBuffer, value: number): void {
  // ref: src/google/protobuf/wire_format_lite.h
  writeVarint32(bb, (value << 1) ^ (value >> 31));
}

function readVarint64ZigZag(bb: ByteBuffer): Long {
  let value = readVarint64(bb, /* unsigned */ false);
  let low = value.low;
  let high = value.high;
  let flip = -(low & 1);

  // ref: src/google/protobuf/wire_format_lite.h
  return {
    low: ((low >>> 1) | (high << 31)) ^ flip,
    high: (high >>> 1) ^ flip,
    unsigned: false,
  };
}

function writeVarint64ZigZag(bb: ByteBuffer, value: Long): void {
  let low = value.low;
  let high = value.high;
  let flip = high >> 31;

  // ref: src/google/protobuf/wire_format_lite.h
  writeVarint64(bb, {
    low: (low << 1) ^ flip,
    high: ((high << 1) | (low >>> 31)) ^ flip,
    unsigned: false,
  });
}
