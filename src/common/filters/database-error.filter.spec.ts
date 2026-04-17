import { ArgumentsHost, HttpStatus } from '@nestjs/common';
import { EntityNotFoundError, QueryFailedError } from 'typeorm';
import { DatabaseErrorFilter } from './database-error.filter';

function makeHost(): { host: ArgumentsHost; res: { status: jest.Mock; json: jest.Mock } } {
  const json = jest.fn();
  const status = jest.fn().mockReturnValue({ json });
  const res = { status, json };
  const host = {
    switchToHttp: () => ({ getResponse: () => res, getRequest: () => ({}) }),
  } as unknown as ArgumentsHost;
  return { host, res };
}

describe('DatabaseErrorFilter', () => {
  let filter: DatabaseErrorFilter;

  beforeEach(() => {
    filter = new DatabaseErrorFilter();
  });

  it('maps EntityNotFoundError to 404', () => {
    const { host, res } = makeHost();
    const err = new EntityNotFoundError({} as never, {});
    filter.catch(err, host);
    expect(res.status).toHaveBeenCalledWith(HttpStatus.NOT_FOUND);
  });

  it('maps unique violation (23505) to 409', () => {
    const { host, res } = makeHost();
    const err = new QueryFailedError('INSERT', [], new Error('dup')) as unknown as QueryFailedError & {
      code?: string;
    };
    (err as { code: string }).code = '23505';
    filter.catch(err, host);
    expect(res.status).toHaveBeenCalledWith(HttpStatus.CONFLICT);
  });

  it('maps foreign key violation (23503) to 400', () => {
    const { host, res } = makeHost();
    const err = new QueryFailedError('INSERT', [], new Error('fk')) as unknown as QueryFailedError & {
      code?: string;
    };
    (err as { code: string }).code = '23503';
    filter.catch(err, host);
    expect(res.status).toHaveBeenCalledWith(HttpStatus.BAD_REQUEST);
  });

  it('maps deadlock (40P01) to 409', () => {
    const { host, res } = makeHost();
    const err = new QueryFailedError('UPDATE', [], new Error('deadlock')) as unknown as QueryFailedError & {
      code?: string;
    };
    (err as { code: string }).code = '40P01';
    filter.catch(err, host);
    expect(res.status).toHaveBeenCalledWith(HttpStatus.CONFLICT);
  });
});
