import React, { createContext, useContext, useEffect, useState } from 'react';
import { authService, User } from '../services/authService';

interface AuthContextType {
    user: User | null;
    login: (username: string) => Promise<boolean>;
    register: (username: string) => Promise<void>;
    logout: () => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const [user, setUser] = useState<User | null>(authService.getUser());

    useEffect(() => {
        const unsubscribe = authService.subscribe((u) => {
            setUser(u);
        });
        return unsubscribe;
    }, []);

    const login = async (username: string) => {
        return authService.login(username);
    };

    const register = async (username: string) => {
        return authService.register(username);
    };

    const logout = () => {
        authService.logout();
    };

    return (
        <AuthContext.Provider value={{ user, login, register, logout }}>
            {children}
        </AuthContext.Provider>
    );
};

export const useAuth = () => {
    const context = useContext(AuthContext);
    if (!context) {
        throw new Error('useAuth must be used within an AuthProvider');
    }
    return context;
};
