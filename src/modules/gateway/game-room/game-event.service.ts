import { Injectable, Logger, Inject } from '@nestjs/common';

// 직업 부여 분리
@Injectable()
export class GameEventService {
  constructor(@Inject(Logger) private readonly logger: Logger) {}

  GrantJob(data: { playerNum: number; jobData: number[] }) {
    this.logger.log(`grantjob ` + data.jobData);
    const grantJob = ['CITIZEN', 'MAFIA', 'DOCTOR', 'POLICE']; // 직업

    let Job = []; //해당 방의 직업

    for (let item = 0; item < data.playerNum; item++) {
      const ran = Math.floor(Math.random() * grantJob.length); //직업
      const jobCountData = Job.filter((item) => item === grantJob[ran]).length; //현재 같은 직업 수

      if (jobCountData < data.jobData[ran]) {
        Job.push(grantJob[ran]);
      } else {
        item--;
      }
    }
    this.logger.log(`grantjob` + Job);

    Job = this.shuffle(Job);

    return Job;
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

    this.logger.log(`grantjob` + strikeOut);

    return strikeOut;
  }

  usePoliceState(num: number, client: any[], user: string) {
    let u, job;
    client.filter((profession) => {
      if (user === profession.user) u = profession.job;
    });
    this.logger.log(`user : ${u}`);

    if (u !== 'POLICE') {
      return null;
    }

    client.filter((profession) => {
      if (num === profession.num) {
        this.logger.log(profession.job);
        job = profession.job;
      }
    });

    return job;
  }
}