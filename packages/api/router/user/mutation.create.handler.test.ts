import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@weareinreach/auth/createUser', () => ({ createCognitoUser: vi.fn() }))
vi.mock('@weareinreach/auth/deleteCognitoUser', () => ({ deleteCognitoUser: vi.fn() }))
vi.mock('@weareinreach/db', () => ({
	getAuditedClient: vi.fn(),
	Prisma: { PrismaClientKnownRequestError: class PrismaClientKnownRequestError extends Error {} },
}))

const { createCognitoUser } = await import('@weareinreach/auth/createUser')
const { deleteCognitoUser } = await import('@weareinreach/auth/deleteCognitoUser')
const { getAuditedClient, Prisma } = await import('@weareinreach/db')
const { default: create } = await import('./mutation.create.handler')

const createCognitoUserMock = vi.mocked(createCognitoUser)
const deleteCognitoUserMock = vi.mocked(deleteCognitoUser)
const getAuditedClientMock = vi.mocked(getAuditedClient)
const userCreateMock = vi.fn()
const accountCreateMock = vi.fn()
const transactionMock = vi.fn()

const input = {
	prisma: { data: { id: 'user_1', email: 'person@example.com' }, select: { id: true } },
	cognito: {
		databaseId: 'user_1',
		email: 'Person@Example.com',
		password: 'test-password',
		message: 'Confirm your account',
		subject: 'Click the following link to confirm your account:',
	},
}

const cognitoUser = {
	cognitoId: 'cognito_1',
	prismaAccount: {
		data: {
			provider: 'cognito',
			providerAccountId: 'cognito_1',
			type: 'credential',
			userId: 'user_1',
		},
	},
}

beforeEach(() => {
	createCognitoUserMock.mockReset().mockResolvedValue(cognitoUser)
	deleteCognitoUserMock.mockReset().mockResolvedValue({} as never)
	userCreateMock.mockReset().mockResolvedValue({ id: 'user_1' })
	accountCreateMock.mockReset().mockResolvedValue({})
	transactionMock
		.mockReset()
		.mockImplementation(async (callback) =>
			callback({ user: { create: userCreateMock }, account: { create: accountCreateMock } })
		)
	getAuditedClientMock.mockReset().mockReturnValue({ $transaction: transactionMock } as never)
})

describe('user.create', () => {
	it('creates the Cognito user after the initial database uniqueness gate', async () => {
		await expect(create({ input } as never)).resolves.toEqual({ success: true })

		expect(createCognitoUserMock).toHaveBeenCalledWith(input.cognito)
		expect(userCreateMock).toHaveBeenCalledWith(input.prisma)
		expect(userCreateMock.mock.invocationCallOrder[0]).toBeLessThan(
			createCognitoUserMock.mock.invocationCallOrder[0] as number
		)
		expect(accountCreateMock).toHaveBeenCalledWith(cognitoUser.prismaAccount)
		expect(deleteCognitoUserMock).not.toHaveBeenCalled()
	})

	it('removes the Cognito user when the database transaction rolls back', async () => {
		const databaseError = new Error('account insert failed')
		accountCreateMock.mockRejectedValueOnce(databaseError)

		await expect(create({ input } as never)).rejects.toBe(databaseError)

		expect(deleteCognitoUserMock).toHaveBeenCalledOnce()
		expect(deleteCognitoUserMock).toHaveBeenCalledWith('Person@Example.com')
	})

	it('maps an initial uniqueness conflict without creating a Cognito user', async () => {
		const conflict = new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
			code: 'P2002',
			clientVersion: 'test',
		})
		;(conflict as unknown as { code: string }).code = 'P2002'
		userCreateMock.mockRejectedValueOnce(conflict)

		await expect(create({ input } as never)).rejects.toMatchObject({ code: 'CONFLICT' })
		expect(createCognitoUserMock).not.toHaveBeenCalled()
		expect(deleteCognitoUserMock).not.toHaveBeenCalled()
	})

	it('removes the Cognito user before mapping a later uniqueness conflict', async () => {
		const conflict = new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
			code: 'P2002',
			clientVersion: 'test',
		})
		;(conflict as unknown as { code: string }).code = 'P2002'
		accountCreateMock.mockRejectedValueOnce(conflict)

		await expect(create({ input } as never)).rejects.toMatchObject({ code: 'CONFLICT' })
		expect(createCognitoUserMock).toHaveBeenCalledOnce()
		expect(deleteCognitoUserMock).toHaveBeenCalledWith('Person@Example.com')
	})

	it('does not attempt cleanup when Cognito creation itself fails', async () => {
		const cognitoError = new Error('signup failed')
		createCognitoUserMock.mockRejectedValueOnce(cognitoError)

		await expect(create({ input } as never)).rejects.toBe(cognitoError)

		expect(transactionMock).toHaveBeenCalledOnce()
		expect(userCreateMock).toHaveBeenCalledOnce()
		expect(accountCreateMock).not.toHaveBeenCalled()
		expect(deleteCognitoUserMock).not.toHaveBeenCalled()
	})

	it('preserves both errors when Cognito cleanup fails', async () => {
		const databaseError = new Error('account insert failed')
		const cleanupError = new Error('cleanup failed')
		accountCreateMock.mockRejectedValueOnce(databaseError)
		deleteCognitoUserMock.mockRejectedValueOnce(cleanupError)

		await expect(create({ input } as never)).rejects.toMatchObject({
			name: 'AggregateError',
			errors: [databaseError, cleanupError],
		})
	})
})
