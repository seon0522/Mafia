import { Game, GameRole } from 'src/entities';
import { AbstractRepository, getConnection, Repository } from 'typeorm';

export class GameRepository extends AbstractRepository<Game> {
  async save(UserProfile, roomId) {
    // await getConnection()
    //   .createQueryBuilder()
    //   .insert()
    //   .into(Game)
    // //   .values()
    //   .execute();
    return this.createQueryBuilder("game")
    .where(Game.)
  }
}
