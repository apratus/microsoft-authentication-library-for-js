// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import { AuthCodeListener } from '../../AuthCodeListener/AuthCodeListener';
import { CustomFileProtocolListener } from '../../AuthCodeListener/CustomFileProtocolListener';
import { AuthenticationParameters } from '../AuthenticationParameters';
import { AuthOptions } from '../AuthOptions';
import { AadAuthority } from '../Authority/AadAuthority';
import { Authority } from '../Authority/Authority';
import { DEFAULT_POPUP_HEIGHT, DEFAULT_POPUP_WIDTH } from '../DefaultConstants';
import { ClientConfigurationError } from '../Error/ClientConfigurationError';
import { AuthorizationCodeRequestParameters } from '../ServerRequest/AuthorizationCodeRequestParameters';
import { TokenRequestParameters } from '../ServerRequest/TokenRequestParameters';
import { AuthCodeReponse } from '../ServerResponse/AuthCodeResponse';
import { TokenResponse } from '../ServerResponse/TokenResponse';
import { ClientApplication } from './ClientApplication';

import { strict as assert, rejects } from 'assert';
import { BrowserWindow } from 'electron';
import * as rp from 'request-promise';
import { TokenRequestError } from '../Error/TokenRequestError';
/**
 * PublicClientApplication class
 *
 * This class can be instantiated into objects that the developer
 * can use in order to acquire tokens.
 */
export class PublicClientApplication extends ClientApplication {
    private authWindow: BrowserWindow;
    private authCodeListener: AuthCodeListener;

    constructor(authOptions: AuthOptions) {
        super(authOptions);
    }

    /**
     * The acquireToken async method uses the Authorization Code
     * Grant to retrieve an access token from the AAD authorization server,
     * which can be used to make authenticated calls to an resource server
     * such as MS Graph.
     */
    public async acquireToken(request: AuthenticationParameters): Promise<string> {
        return new Promise<string>((resolve, reject) => {
            try {
                // Validate and filter scopes
                this.validateInputScopes(request.scopes);
                // Set Authority URL from developer input or default if not in request
                const authorityUrl = request.authority ? request.authority : this.authorityUrl;
                // Create Authority Instance
                const authorityInstance = new AadAuthority(authorityUrl);
                // Get AccessToken
                const accessToken = this.acquireTokenWithAuthCode(authorityInstance, request.scopes);
                resolve(accessToken);
            } catch (error) {
                return reject(error);
            }
        });
    }

    /**
     * Executes a series of checks and validations on the scopes array
     * that was sent in the PublicClientApplication's constructor.
     * @param scopes
     */
    private validateInputScopes(scopes: string[]): void {
        // Throws if scopes object is not truthy
        assert(scopes, ClientConfigurationError.createScopesRequiredError(scopes));

        // Throws if scopes object is not an array.
        if (!Array.isArray(scopes)) {
            throw ClientConfigurationError.createScopesNonArrayError(scopes);
        }

        // Throws if scopes array is empty.
        if (scopes.length < 1) {
            throw ClientConfigurationError.createEmptyScopesArrayError(scopes);
        }
    }

    /**
     * This method is responsible for getting an authorization code
     * from the authorization endpoint of the authorization server
     * and exchanging it for an access token with the token endpoint.
     * @param authorityInstance
     * @param scopes
     */
    private async acquireTokenWithAuthCode(authorityInstance: Authority, scopes: string[]): Promise<string> {
        // Register custom protocol to listen for auth code response
        this.authCodeListener = new CustomFileProtocolListener('msal');
        this.authCodeListener.start();

        // Build navigate URL for auth code request
        const navigateUrl = this.buildAuthCodeUrl(authorityInstance, scopes);
        // Retrieve auth code
        const authCode = await this.listenForAuthCode(navigateUrl);
        // Get and return access token
        return await this.tradeAuthCodeForAccessToken(authorityInstance, scopes, authCode);
    }

    /**
     * Trades authorization code for an access token
     * with the token endpoint of the authorization server
     * @param authorityInstance
     * @param scopes
     * @param authCode
     */
    private tradeAuthCodeForAccessToken(authorityInstance: Authority, scopes: string[], authCode: string): Promise<string> {
        // Build token request URL
        const tokenRequest = this.buildTokenRequest(authorityInstance, scopes, authCode);
        return rp(tokenRequest.body).then((body) => {
            const tokenResponse = new TokenResponse(body);
            return tokenResponse.accessToken;
        }).catch((responseError) => {
            const tokenError = JSON.parse(responseError.error);
            throw new TokenRequestError(tokenError.error, tokenError.error_description);
        });
    }

    /**
     * Builds request options for a token endpoint request
     * @param authorityInstance
     * @param scopes
     * @param authCode
     */
    private buildTokenRequest(authorityInstance: Authority, scopes: string[], authCode: string): TokenRequestParameters {
        // Build Server Token Request
        const tokenRequestParameters = new TokenRequestParameters(
            authorityInstance,
            this.clientId,
            this.redirectUri,
            scopes,
            authCode
        );

        // Create request URI string from request parameters
        return tokenRequestParameters;
    }

    /**
     * Builds URL for auth code authorization request
     * @param authorityInstance
     * @param scopes
     */
    private buildAuthCodeUrl(authorityInstance: Authority, scopes: string[]): string {
        // Build Server Authorization Request
        const authCodeRequestParameters = new AuthorizationCodeRequestParameters(
            authorityInstance,
            this.clientId,
            this.redirectUri,
            scopes
        );

        // Create navigate URL string from request parameters
        return authCodeRequestParameters.buildRequestUrl();
    }

    /**
     * Creates a listener for 'will-redirect' event on the
     * auth window and returns the authorization code from the
     * server's response.
     */
    private async listenForAuthCode(navigateUrl: string): Promise<string> {
        // Open PopUp window and load the navigate URL
        this.openAuthWindow();
        this.authWindow.loadURL(navigateUrl);

        // Listen for 'will-redirect' BrowserWindow event
        return new Promise((resolve, reject) => {
            this.authWindow.webContents.on('will-redirect', (event, responseUrl) => {
                const authCodeResponse = new AuthCodeReponse(responseUrl);
                if (authCodeResponse.error) {
                    reject(authCodeResponse.error);
                } else {
                    resolve(authCodeResponse.code);
                }
                // Close authWindow and Auth Code Listener
                this.authWindow.close();
                this.authCodeListener.close();
            });
        });
    }

    /**
     * This method opens a PopUp browser window that will
     * be used to authenticate the user.
     */
    private openAuthWindow(): void {
        this.authWindow = new BrowserWindow({
            height: DEFAULT_POPUP_HEIGHT,
            width: DEFAULT_POPUP_WIDTH,
            alwaysOnTop: true,
            webPreferences: {
                contextIsolation: true,
            },
        });

        // Nullify the authWindow member when the browser window is closed
        this.authWindow.on('closed', () => {
            this.authWindow = null;
        });
    }
}
