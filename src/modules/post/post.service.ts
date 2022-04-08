import {
  ForbiddenException,
  Inject,
  Injectable,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { CreatePostDto, PostFindOneDto, UpdatePostDto } from './dto';
import { PostRepository } from './post.repository';
import { Pagination } from './paginate';
import { ConfigService } from '@nestjs/config';
import { Connection } from 'typeorm';
import { ImageService } from '../image/image.service';
import { promiseAllSetteldResult } from 'src/shared/promise-all-settled-result';

@Injectable()
export class PostService {
  constructor(
    private readonly postRepository: PostRepository,
    @Inject(Logger) private readonly logger = new Logger('PostService'),
    private readonly configService: ConfigService,
    private readonly connection: Connection,
    private readonly imageService: ImageService,
  ) {}

  async create(userId: number, createPostDto: CreatePostDto) {
    const queryRunner = this.connection.createQueryRunner();
    await queryRunner.startTransaction();

    try {
      const result = await this.postRepository.create(userId, createPostDto);
      const postId = result.identifiers[0].id;

      const { images } = createPostDto;
      if (images) {
        const { value, reason } = await promiseAllSetteldResult(
          images.map((image) => this.imageService.saveImagePost(postId, image)),
        );

        if (reason[0]) {
          this.logger.error(
            'Rejected result when save image id and post id in post service',
            reason,
          );
        }
      }

      queryRunner.commitTransaction();
      return postId;
    } catch (error) {
      queryRunner.rollbackTransaction();
      throw new InternalServerErrorException('Server error when create post');
    } finally {
      queryRunner.release();
    }
  }

  async findOne(id: number, userId?: number): Promise<PostFindOneDto> {
    const { entities, raw } = await this.postRepository.findOne(id, userId);
    const post: any = entities[0];
    post.isLiked = raw[0].isLiked ? true : false;
    return post;
  }
  async findAll(categoryId: number, page: number) {
    const items = await this.postRepository.findAll(
      categoryId,
      (page - 1) * 10,
    );
    const totalItems = await this.postRepository.findPagesCountByCategoryId(
      categoryId,
    );
    const totalPages = Math.ceil(totalItems / 10);
    const itemCount = items.length;
    const temp = Math.floor(page / 10);
    const links = {};

    for (let i = 1; i <= 10; i++) {
      const tPage = i + temp * 10;
      if (tPage > totalPages) break;
      links[i] = `${this.configService.get(
        'BACKEND_URL',
      )}/posts?category=${categoryId}&page=${tPage}`;
    }

    const data = new Pagination(
      items,
      {
        itemCount,
        totalItems,
        totalPages,
        currentPage: page,
      },
      links,
    );

    return data;
  }
  async update(id: number, updatePostDto: UpdatePostDto) {
    const { updateImages, removeImages } = updatePostDto;
    let keys: string[];

    const queryRunner = this.connection.createQueryRunner();
    await queryRunner.startTransaction();

    try {
      if (removeImages) {
        //image location으로 image 검색
        const existImages = await this.imageService.findByLocation(
          removeImages,
        );

        //image id key 배열로 가져옴
        const { arrayOfId, arrayOfKey } =
          this.getIdAndKeyOutOfImages(existImages);
        keys = arrayOfKey;
        console.log(keys);

        //image id 배열로 image 삭제
        await this.imageService.remove({
          id: arrayOfId,
        });
      }
      if (updateImages) {
        // update images 다대다 테이블에 저장
        await this.imageService.saveImagePost(id, updateImages);
      }
      await this.postRepository.update(id, updatePostDto, queryRunner);
      await queryRunner.commitTransaction();
      await this.imageService.deleteS3Objects(keys);
    } catch (error) {
      queryRunner.rollbackTransaction();
      throw new InternalServerErrorException(
        'Server error when update post',
        error,
      );
    } finally {
      queryRunner.release();
    }
  }
  getIdAndKeyOutOfImages(images: { id: number; key: string }[]) {
    const arrayOfId = [];
    const arrayOfKey = [];
    for (const image of images) {
      arrayOfId.push(image.id);
      arrayOfKey.push(image.key);
    }
    return { arrayOfId, arrayOfKey };
  }

  async like(postId: number, userId: number) {
    const isLiked = await this.isLiked(postId, userId);
    if (isLiked) {
      throw new ForbiddenException('권한이 없습니다');
    }
    await this.postRepository.like(postId, userId);
    return { postId, like: true };
  }
  async unlike(postId: number, userId: number) {
    const isLiked = await this.isLiked(postId, userId);
    if (!isLiked) {
      throw new ForbiddenException('권한이 없습니다');
    }
    await this.postRepository.unlike(postId, userId);
    return { postId, unlike: true };
  }
  async isLiked(postId: number, userId: number) {
    return await this.postRepository.isLiked(postId, userId);
  }

  async remove(id: number) {
    const queryRunner = this.connection.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      const images = await this.imageService.findByPostId(id);

      const keys = images.map((image) => image.key);

      const { value, reason } = await promiseAllSetteldResult([
        this.postRepository.remove(id),
        images.map((image) => this.imageService.remove({ id: image.id })),
      ]);
      await this.imageService.deleteS3Objects(keys);

      if (reason) {
        this.logger.error('Error when remove post', reason);
      }

      await queryRunner.commitTransaction();
      return { postId: id, delete: true };
    } catch (error) {
      this.logger.error(error);
      await queryRunner.rollbackTransaction();
      throw new InternalServerErrorException('server error when remove post');
    } finally {
      queryRunner.release();
    }
  }

  async removeImage(keys: string[]) {
    try {
      const deleteImages = this.imageService.deleteS3Objects(keys);
      const removeImages = keys.map((key) => this.imageService.remove({ key }));
      const { value, reason } = await promiseAllSetteldResult([
        deleteImages,
        removeImages,
      ]);

      if (reason) {
        this.logger.error('Error when remove image', reason);
      }

      return { remove: true, keys };
    } catch (error) {
      this.logger.error(error);
    }
  }
}
