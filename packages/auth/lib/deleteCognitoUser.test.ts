import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@weareinreach/env', () => ({ getEnv: vi.fn() }))
vi.mock('./cognitoClient', () => ({ cognito: { adminDeleteUser: vi.fn() } }))

const { getEnv } = await import('@weareinreach/env')
const { cognito } = await import('./cognitoClient')
const { deleteCognitoUser } = await import('./deleteCognitoUser')

const getEnvMock = vi.mocked(getEnv)
const adminDeleteUserMock = vi.mocked(cognito.adminDeleteUser)

beforeEach(() => {
	getEnvMock.mockReset().mockReturnValue('test-user-pool')
	adminDeleteUserMock.mockReset().mockResolvedValue({} as never)
})

describe('deleteCognitoUser', () => {
	it('deletes the lowercased signup username from the configured user pool', async () => {
		await deleteCognitoUser('Person@Example.com')

		expect(getEnvMock).toHaveBeenCalledWith('COGNITO_USER_POOL_ID')
		expect(adminDeleteUserMock).toHaveBeenCalledWith({
			UserPoolId: 'test-user-pool',
			Username: 'person@example.com',
		})
	})
})
