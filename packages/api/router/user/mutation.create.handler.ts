import { TRPCError } from '@trpc/server'

import { createCognitoUser } from '@weareinreach/auth/createUser'
import { deleteCognitoUser } from '@weareinreach/auth/deleteCognitoUser'
import { getAuditedClient, Prisma } from '@weareinreach/db'
import { type TRPCHandlerParams } from '~api/types/handler'

import { type TCreateSchema } from './mutation.create.schema'

const create = async ({ input }: TRPCHandlerParams<TCreateSchema>) => {
	const prisma = getAuditedClient(input.prisma.data.id)
	let cognitoUserCreated = false

	const rollbackCognitoUser = async (cause: unknown) => {
		try {
			await deleteCognitoUser(input.cognito.email)
		} catch (cleanupError) {
			throw new AggregateError(
				[cause, cleanupError],
				'Could not remove Cognito user after database signup failed'
			)
		}
	}

	try {
		const newUser = await prisma.$transaction(async (tx) => {
			const user = await tx.user.create(input.prisma)
			if (user.id !== input.cognito.databaseId) {
				throw new Error('Database ID mismatch')
			}
			const cognitoUser = await createCognitoUser(input.cognito)
			cognitoUserCreated = true
			if (cognitoUser?.prismaAccount) {
				await tx.account.create(cognitoUser.prismaAccount)
			}

			if (user.id && cognitoUser?.cognitoId) {
				return { success: true }
			}
			throw new Error('Could not create user')
		})
		return newUser
	} catch (error) {
		if (cognitoUserCreated) {
			await rollbackCognitoUser(error)
		}
		if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
			throw new TRPCError({ code: 'CONFLICT', message: 'User already exists' })
		}
		throw error
	}
}
export default create
