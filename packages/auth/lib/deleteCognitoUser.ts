import { getEnv } from '@weareinreach/env'

import { cognito } from './cognitoClient'

export const deleteCognitoUser = async (email: string) =>
	cognito.adminDeleteUser({
		UserPoolId: getEnv('COGNITO_USER_POOL_ID'),
		Username: email.toLowerCase(),
	})
