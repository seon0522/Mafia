import { Injectable, Logger, Inject } from '@nestjs/common';
import { MessageBody, WsException } from '@nestjs/websockets';
import dayjs from 'dayjs';
import { Player } from 'src/modules/game-room/dto/player';
import { RedisService } from 'src/modules/redis/redis.service';
import { UserProfile } from '../../user/dto/user-profile.dto';
import {
  MAFIAS_FIELD,
  NUM_FIELD,
  EXLEAVE_FIELD,
  EXDIE_FIELD,
} from './constants/game-redis-key-prefix';
import {
  DOCTOR_FIELD,
  FINISH_VOTE_FIELD,
  GAME,
  MAFIA_FIELD,
  PLAYERJOB_FIELD,
  PLAYERNUM_FIELD,
  PLAYER_FIELD,
  PUNISH_FIELD,
  VOTE_FIELD,
} from './constants/game-redis-key-prefix';
import { EnumGameRole } from 'src/common/constants';
import { GameRepository } from 'src/modules/game/game.repository';
import { LessThan } from 'typeorm';

// 직업 부여 분리
@Injectable()
export class GameEventService {
  constructor(
    @Inject(Logger) private readonly logger: Logger,
    private readonly redisService: RedisService,
    private readonly gameRepository: GameRepository,
  ) {}

  timer() {
    const now = dayjs();

    //시작 신호
    const startTime = now.format();
    this.logger.log(`start: ${startTime}`);

    //만료 신호
    const endTime = now.add(1, 'm').format();
    this.logger.log(`end: ${endTime}`);

    return { start: startTime, end: endTime };
  }

  // 해당 방의 게임 플레이어 값을 찾아서 제공.
  async findPlayers(roomId: number): Promise<Player[]> {
    const players = await this.redisService.hget(
      this.makeGameKey(roomId),
      PLAYER_FIELD,
    );

    if (!players) {
      throw new WsException('존재하지 않는 게임입니다');
    }

    return players;
  }

  // async findGame(roomId: number): Promise<GameRoom> {
  //   const game = await this.redisService.hget(
  //     this.makeGameKey(roomId),
  //     INFO_FIELD,
  //   );
  //   if (!game) {
  //     throw new WsException('존재하지 않는 게임입니다');
  //   }

  //   return game;
  // }

  async getPlayerJobs(roomId: number): Promise<Player[]> {
    try {
      const playerJobs = await this.redisService.hget(
        this.makeGameKey(roomId),
        PLAYERJOB_FIELD,
      );
      return playerJobs;
    } catch (err) {
      console.log(err);
    }
  }
  async setMafiaSearch(roomId: number, player: Player[]) {
    await this.redisService.hset(
      this.makeGameKey(roomId),
      MAFIAS_FIELD,
      player,
    );
  }

  async getMafiaSearch(roomId: number): Promise<Player[]> {
    return await this.redisService.hget(this.makeGameKey(roomId), MAFIAS_FIELD);
  }

  async leaveUser(roomId: number, user: UserProfile) {
    this.logger.log(`leaveUser event`);
    const gamePlayer: Player[] = await this.getPlayerJobs(roomId);
    let leaveplayer;

    const newGamePlayer = gamePlayer.map((player) => {
      if (player !== null && player.userId === user.id) {
        leaveplayer = player;
        player = null;
      }
      return player;
    });

    this.logger.log(`leave 유저 gameId ${leaveplayer.gameId}`);
    // 탈주 유저  redis 처리
    await this.setLeave(roomId, leaveplayer);

    await this.gameRepository.leave(leaveplayer);

    //  player 저장
    await this.redisService.hset(
      this.makeGameKey(roomId),
      PLAYERJOB_FIELD,
      newGamePlayer,
    );

    this.logger.log(`leaveplayer`);
    // this.logger.log(leaveplayer);

    return leaveplayer;
  }

  async setLeave(roomId: number, player: Player) {
    const leaveusers = (await this.getLeave(roomId)) || [];

    leaveusers.push(player);

    return this.redisService.hset(
      this.makeGameKey(roomId),
      EXLEAVE_FIELD,
      leaveusers,
    );
  }

  async getLeave(roomId: number) {
    return await this.redisService.hget(
      this.makeGameKey(roomId),
      EXLEAVE_FIELD,
    );
  }

  async setPlayerJob(roomId, Player: Player[]) {
    await this.redisService.hset(
      this.makeGameKey(roomId),
      PLAYERJOB_FIELD,
      Player,
    );
  }

  async PlayerJobs(roomId: number, job: number[], Num: number) {
    const jobs = this.grantJob(job, Num);
    const playerJobs = await this.findPlayers(roomId);
    const mafias = [];

    for (let i = 0; i < Num; i++) {
      playerJobs[i].job = jobs[i];
      if (playerJobs[i].job === EnumGameRole.MAFIA) {
        playerJobs[i].team = EnumGameRole.MAFIA;
        mafias.push(playerJobs[i]);
        continue;
      }
      playerJobs[i].team = EnumGameRole.CITIZEN;
    }

    await this.setMafiaSearch(roomId, mafias);

    await this.setPlayerJob(roomId, playerJobs);

    await this.gameRepository.setRole(playerJobs);
  }

  getJobData(playerCount: number) {
    const mafia = playerCount > 6 ? 2 : 1;
    const doctor = 1;
    const police = 1;

    const cr = playerCount < 4 ? 1 : playerCount - (mafia + doctor + police);

    const jobData = [cr, mafia, doctor, police];

    this.logger.log('jobData');
    this.logger.log(jobData);
    return jobData;
  }

  grantJob(job: number[], Num: number) {
    const grantJob = [
      EnumGameRole.CITIZEN,
      EnumGameRole.MAFIA,
      EnumGameRole.DOCTOR,
      EnumGameRole.POLICE,
    ];

    const roomJob = []; //해당 방의 직업
    let typesOfJobs = 0;
    for (let jobs = 0; jobs < Num; jobs++) {
      this.logger.log('grantJob');
      roomJob.push(grantJob[typesOfJobs]);
      job[typesOfJobs]--;

      if (!job[typesOfJobs]) typesOfJobs++;
    }

    return this.shuffle(roomJob);
  }

  shuffle(job: string[]) {
    // 직업 셔플
    const strikeOut = [];
    while (job.length) {
      const lastidx = job.length - 1;
      const roll = Math.floor(Math.random() * job.length);
      const temp = job[lastidx];
      job[lastidx] = job[roll];
      job[roll] = temp;
      strikeOut.push(job.pop());
    }

    return strikeOut;
  }

  async sortfinishVote(roomId: number) {
    let redisVote = {};
    const vote = await this.getVote(roomId);

    if (!vote) {
      return null;
    }

    // 해당 숫자값 세주기
    vote.forEach((element) => {
      redisVote[element] = (redisVote[element] || 0) + 1;
    });

    redisVote = this.sortObject(redisVote, 'userNum', 'vote');

    await this.redisService.hset(
      this.makeGameKey(roomId),
      FINISH_VOTE_FIELD,
      redisVote,
    );

    return redisVote;
  }

  sortObject(obj, userNum: string, voteNum: string) {
    const arr = [];
    for (const prop in obj) {
      if (obj.hasOwnProperty(prop)) {
        arr.push({
          userNum: prop,
          voteNum: obj[prop],
        });
      }
    }
    arr.sort(function (a, b) {
      return b.voteNum - a.voteNum;
    });
    return arr;
  }

  async getVoteDeath(roomId: number) {
    const votehumon = await this.redisService.hget(
      this.makeGameKey(roomId),
      FINISH_VOTE_FIELD,
    );

    this.logger.log(votehumon);
    this.logger.log(`죽이려는 대상의 번호가 맞나..? ${votehumon[0]}`);

    return votehumon[0].userNum;
  }

  async death(roomId: number, userNum: number) {
    const gamePlayer = await this.getPlayerJobs(roomId);
    const dieUser = gamePlayer[userNum - 1];

    dieUser.die = !dieUser.die;

    await this.redisService.hset(
      this.makeGameKey(roomId),
      PLAYERJOB_FIELD,
      gamePlayer,
    );

    await this.setDie(roomId, dieUser);

    return dieUser;
  }

  async setDie(roomId: number, player: Player) {
    const dieUser = (await this.getDie(roomId)) || [];

    dieUser.push(player);

    return await this.redisService.hset(
      this.makeGameKey(roomId),
      EXDIE_FIELD,
      dieUser,
    );
  }

  async getDie(roomId: number) {
    return await this.redisService.hget(this.makeGameKey(roomId), EXDIE_FIELD);
  }

  async useState(roomId: number) {
    const gamePlayer = await this.getPlayerJobs(roomId);
    const mafias = await this.getMafiaSearch(roomId);

    const mafiavotes = await this.getMafia(roomId);
    const set = Array.from(new Set(mafiavotes));

    try {
      const mafiaNum = mafias.length === set.length ? +set[0] : null;

      const doctorNum = await this.getDoctor(roomId);

      // 아무 이벤트도 안 일어날 시,
      if (!mafiaNum) return null;

      // 마피아가 죽일 때
      if (mafiaNum !== doctorNum) {
        this.logger.log(`마피아가 ${mafiaNum} 을 살해하였습니다.`);
        await this.death(roomId, mafiaNum);
      }

      if (mafiaNum === doctorNum) {
        this.logger.log(`의사가 ${mafiaNum} 을 살렸습니다.`);
      }

      // Todo 메세지를 주도록, 살해했습니다.
      this.logger.log(gamePlayer[mafiaNum - 1].die);
      return { userNum: mafiaNum, die: gamePlayer[mafiaNum - 1].die };
    } catch (error) {
      this.logger.error(`useState error `, error);
    }
  }

  makeGameKey(roomId: number): string {
    return `${GAME}:${roomId}`;
  }

  async usePolice(
    roomId: number,
    userNum: number,
    user: UserProfile,
  ): Promise<string> {
    const gamePlayer = await this.getPlayerJobs(roomId);

    let police;

    for (const player of gamePlayer) {
      if (player.id === user.profile.id) {
        police = player.job;
        break;
      }
    }

    if (police !== EnumGameRole.POLICE) {
      throw new WsException('경찰이 아닙니다.');
    } else {
      return gamePlayer[userNum].job;
    }
  }

  async useMafia(
    roomId: number,
    userNum: number,
    user: UserProfile,
  ): Promise<number> {
    const gamePlayer = await this.getPlayerJobs(roomId);
    const maifas = await this.getMafiaSearch(roomId);
    const mafiavotes = (await this.getMafia(roomId)) || [];

    // let mafia;

    // 마피아일 경우에만 값 넣기
    // for (const player of maifas) {
    //   if (player.userId === user.id) {
    //     mafiavotes.push(userNum);
    //     break;
    //   }
    // }

    for (const player of gamePlayer) {
      if (player.userId === user.id && player.job !== EnumGameRole.MAFIA) {
        throw new WsException('마피아가 아닙니다.');
      }
    }

    mafiavotes.push(userNum);

    await this.setMafia(roomId, mafiavotes);

    return userNum;
  }
  async getMafia(roomId: number) {
    return await this.redisService.hget(this.makeGameKey(roomId), MAFIA_FIELD);
  }

  async setMafia(roomId: number, userNum: number) {
    await this.redisService.hset(
      this.makeGameKey(roomId),
      MAFIA_FIELD,
      userNum,
    );
  }

  async getDoctor(roomId: number) {
    return await this.redisService.hget(this.makeGameKey(roomId), DOCTOR_FIELD);
  }

  async setDoctor(roomId: number, userNum: number) {
    await this.redisService.hset(
      this.makeGameKey(roomId),
      DOCTOR_FIELD,
      userNum,
    );
  }

  async useDoctor(
    roomId: number,
    userNum: number,
    user: UserProfile,
  ): Promise<number> {
    const gamePlayer = await this.getPlayerJobs(roomId);

    for (const player of gamePlayer) {
      if (player.userId === user.id && player.job !== EnumGameRole.DOCTOR) {
        throw new WsException('의사가 아닙니다.');
      }
    }

    await this.setDoctor(roomId, userNum);

    return userNum;
  }

  //살아있는 각 팀멤버 수
  async livingHuman(roomId: number) {
    const gamePlayer = await this.redisService.hget(
      this.makeGameKey(roomId),
      PLAYERJOB_FIELD,
    );

    const livingMafia = gamePlayer.filter((player) => {
      if (
        player !== null &&
        player.team === EnumGameRole.MAFIA &&
        player.die === false
      ) {
        return true;
      }
    }).length;

    const livingCitizen = gamePlayer.filter((player) => {
      if (
        player !== null &&
        player.team === EnumGameRole.CITIZEN &&
        player.die === false
      ) {
        return true;
      }
    }).length;

    return { mafia: livingMafia, citizen: livingCitizen };
  }

  // Todo 죽은 사람, 탈주 유저의 수 redis로 따로 빼서 체크.
  async setPlayerCheckNum(roomId: number, user: UserProfile) {
    const players = await this.getPlayerJobs(roomId);
    const playerDie = (await this.getDie(roomId)) || 0;
    const playerLeave = (await this.getLeave(roomId)) || 0;

    let count;
    for (const player of players) {
      if (player.userId === user.id) {
        count = await this.setPlayerNum(roomId);
        break;
      }
    }
    const playerSum = players.length - (playerDie.length - playerLeave.length);

    this.logger.log(`총 인원 ${playerSum}, count ${count}`);

    return { playerSum: playerSum, count: count };
  }

  async voteValidation(roomId: number, vote: number) {
    const players = await this.getPlayerJobs(roomId);

    if (players[vote - 1] === null && players[vote - 1].die === true)
      throw new WsException('투표할 수 없는 유저입니다.');

    return vote;
  }

  async CheckNum(roomId: number, user) {
    const players = await this.getPlayerJobs(roomId);
    const playerDie = (await this.getDie(roomId)) || 0;
    const playerLeave = (await this.getLeave(roomId)) || 0;

    let count;
    for (const player of players) {
      if (player.id === user.profile.id) {
        count = await this.setNum(roomId);
        break;
      }
    }

    const playerSum = players.length - (playerDie.length - playerLeave.length);

    return { playerSum: playerSum, count: count };
  }

  async setNum(roomId: number) {
    return await this.redisService.hincrby(this.makeGameKey(roomId), NUM_FIELD);
  }

  async delNum(roomId: number) {
    return await this.redisService.hdel(this.makeGameKey(roomId), NUM_FIELD);
  }

  async winner(roomId: number): Promise<EnumGameRole> | null {
    const { mafia, citizen } = await this.livingHuman(roomId);

    if (!mafia) {
      return EnumGameRole.CITIZEN;
    } else if (mafia >= citizen) {
      return EnumGameRole.MAFIA;
    }
    return null;
  }

  async setVote(roomId: number, vote: number): Promise<any> {
    let votes = await this.getVote(roomId);

    if (!votes) votes = [];

    votes.push(vote);

    return await this.redisService.hset(
      this.makeGameKey(roomId),
      VOTE_FIELD,
      votes,
    );
  }

  async getPunish(roomId: number): Promise<any> {
    return await this.redisService.hget(this.makeGameKey(roomId), PUNISH_FIELD);
  }

  async getPunishSum(roomId: number) {
    const punish = await this.getPunish(roomId);

    this.logger.log(punish);

    const punisAgreement = punish.filter((item) => {
      return item === true;
    }).length;

    this.logger.log(punisAgreement);

    return punisAgreement;
  }

  async setPunish(roomId: number, punish: boolean): Promise<any> {
    let punishs = await this.getPunish(roomId);

    if (!punishs) punishs = [];
    punishs.push(punish);

    return await this.redisService.hset(
      this.makeGameKey(roomId),
      PUNISH_FIELD,
      punishs,
    );
  }

  async getVote(roomId: number): Promise<number[]> {
    return await this.redisService.hget(this.makeGameKey(roomId), VOTE_FIELD);
  }

  async setPlayerNum(roomId: number) {
    return await this.redisService.hincrby(
      this.makeGameKey(roomId),
      PLAYERNUM_FIELD,
    );
  }

  async delPlayerNum(roomId: number) {
    return await this.redisService.hdel(
      this.makeGameKey(roomId),
      PLAYERNUM_FIELD,
    );
  }

  async delValue(roomId: number, value) {
    const key = this.makeGameKey(roomId);

    switch (value) {
      case MAFIA_FIELD:
      case DOCTOR_FIELD:
        await this.redisService.hdel(key, MAFIA_FIELD);
        await this.redisService.hdel(key, DOCTOR_FIELD);
        break;
      case VOTE_FIELD:
      case FINISH_VOTE_FIELD:
      case PUNISH_FIELD:
        await this.redisService.hdel(key, VOTE_FIELD);
        await this.redisService.hdel(key, FINISH_VOTE_FIELD);
        await this.redisService.hdel(key, PUNISH_FIELD);
        break;
    }
  }

  async SaveTheEntireGame(roomId: number, winner: EnumGameRole) {
    const gamePlayer = await this.getPlayerJobs(roomId);

    const saveplayer = gamePlayer.filter((x): x is Player => x !== null);

    return await this.gameRepository.saveGameScore(saveplayer, winner);
  }
}
