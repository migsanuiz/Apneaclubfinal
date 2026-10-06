import React, {
  useCallback,
  useEffect,
  useMemo,
  useState,
} from 'react';

import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  RefreshControl,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';

import * as Notifications from 'expo-notifications';
import * as Device from 'expo-device';
import Constants from 'expo-constants';

import { supabase } from './lib/supabase';


/* =========================================================
   NOTIFICACIONES
========================================================= */

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});


/* =========================================================
   UTILIDADES
========================================================= */

function formatDate(dateString) {
  try {
    return new Date(dateString).toLocaleString(
      'es-ES',
      {
        dateStyle: 'medium',
        timeStyle: 'short',
      }
    );
  } catch {
    return dateString;
  }
}


function formatStatic(seconds) {
  if (!seconds) return '—';

  const minutes = Math.floor(seconds / 60);

  const remainingSeconds =
    seconds % 60;

  return `${minutes}:${String(
    remainingSeconds
  ).padStart(2, '0')} min`;
}


function parseStatic(value) {
  const clean = value.trim();

  if (!clean) return null;

  if (clean.includes(':')) {
    const parts = clean.split(':');

    const minutes = Number(parts[0]);
    const seconds = Number(parts[1]);

    if (
      !Number.isFinite(minutes) ||
      !Number.isFinite(seconds) ||
      seconds < 0 ||
      seconds >= 60
    ) {
      return null;
    }

    return (
      minutes * 60 +
      seconds
    );
  }

  const numeric = Number(clean);

  if (
    Number.isFinite(numeric) &&
    numeric > 0
  ) {
    return Math.round(numeric * 60);
  }

  return null;
}


function parseDateTime(
  date,
  time
) {
  const cleanDate = date.trim();
  const cleanTime = time.trim();

  if (!cleanDate || !cleanTime) {
    return null;
  }

  const result = new Date(
    `${cleanDate}T${cleanTime}:00`
  );

  if (
    Number.isNaN(result.getTime())
  ) {
    return null;
  }

  return result.toISOString();
}


/* =========================================================
   APP
========================================================= */

export default function App() {
  const [session, setSession] =
    useState(null);

  const [profile, setProfile] =
    useState(null);

  const [loading, setLoading] =
    useState(true);

  const [profileLoading, setProfileLoading] =
    useState(false);


  const loadProfile = useCallback(
    async (userId) => {
      setProfileLoading(true);

      try {
        const {
          data,
          error,
        } = await supabase
          .from('profiles')
          .select('*')
          .eq('id', userId)
          .maybeSingle();

        if (error) {
          console.log(
            'Error cargando perfil:',
            error
          );

          setProfile(null);

          return null;
        }

        setProfile(data);

        return data;
      } finally {
        setProfileLoading(false);
      }
    },
    []
  );


  const registerPushToken =
    useCallback(
      async (userId) => {
        try {
          if (!Device.isDevice) {
            return;
          }

          const permissions =
            await Notifications.getPermissionsAsync();

          let status =
            permissions.status;

          if (
            status !== 'granted'
          ) {
            const result =
              await Notifications.requestPermissionsAsync();

            status = result.status;
          }

          if (
            status !== 'granted'
          ) {
            return;
          }

          const projectId =
            Constants?.expoConfig?.extra
              ?.eas?.projectId ??
            Constants?.easConfig?.projectId;

          if (!projectId) {
            console.log(
              'No existe EAS projectId para Push Notifications.'
            );

            return;
          }

          if (
            Platform.OS === 'android'
          ) {
            await Notifications.setNotificationChannelAsync(
              'default',
              {
                name: 'default',
                importance:
                  Notifications.AndroidImportance
                    .MAX,
                vibrationPattern: [
                  0,
                  250,
                  250,
                  250,
                ],
                sound: 'default',
              }
            );
          }

          const token =
            await Notifications.getExpoPushTokenAsync(
              {
                projectId,
              }
            );

          if (!token?.data) {
            return;
          }

          const {
            error,
          } = await supabase
            .from('push_tokens')
            .upsert(
              {
                user_id: userId,
                token: token.data,
                platform:
                  Platform.OS,
              },
              {
                onConflict:
                  'user_id,token',
              }
            );

          if (error) {
            console.log(
              'Error guardando push token:',
              error
            );
          }
        } catch (error) {
          console.log(
            'Error registrando push:',
            error
          );
        }
      },
      []
    );


  useEffect(() => {
    let mounted = true;

    const initialise =
      async () => {
        try {
          const {
            data: {
              session:
                existingSession,
            },
          } =
            await supabase.auth.getSession();

          if (!mounted) return;

          setSession(
            existingSession
          );

          if (
            existingSession?.user
          ) {
            await loadProfile(
              existingSession.user.id
            );

            await registerPushToken(
              existingSession.user.id
            );
          }
        } catch (error) {
          console.log(
            'Error inicializando:',
            error
          );
        } finally {
          if (mounted) {
            setLoading(false);
          }
        }
      };

    initialise();

    const {
      data: {
        subscription,
      },
    } =
      supabase.auth.onAuthStateChange(
        (event, newSession) => {
          if (!mounted) return;

          setSession(
            newSession
          );

          if (
            newSession?.user
          ) {
            setTimeout(() => {
              loadProfile(
                newSession.user.id
              );

              registerPushToken(
                newSession.user.id
              );
            }, 0);
          } else {
            setProfile(null);
          }
        }
      );

    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, [
    loadProfile,
    registerPushToken,
  ]);


  const signIn = async (
    email,
    password
  ) => {
    const cleanEmail =
      email.trim().toLowerCase();

    if (!cleanEmail) {
      Alert.alert(
        'Error',
        'Introduce tu email.'
      );

      return false;
    }

    if (!password) {
      Alert.alert(
        'Error',
        'Introduce tu contraseña.'
      );

      return false;
    }

    const {
      error,
    } =
      await supabase.auth.signInWithPassword(
        {
          email: cleanEmail,
          password,
        }
      );

    if (error) {
      Alert.alert(
        'No se pudo iniciar sesión',
        traducirError(error.message)
      );

      return false;
    }

    return true;
  };


  const signUp = async (
    email,
    password,
    name
  ) => {
    const cleanEmail =
      email.trim().toLowerCase();

    const cleanName =
      name.trim();

    if (!cleanName) {
      Alert.alert(
        'Error',
        'Introduce tu nombre.'
      );

      return false;
    }

    if (
      cleanName.length < 2
    ) {
      Alert.alert(
        'Error',
        'El nombre debe tener al menos 2 caracteres.'
      );

      return false;
    }

    if (!cleanEmail) {
      Alert.alert(
        'Error',
        'Introduce tu email.'
      );

      return false;
    }

    if (
      password.length < 6
    ) {
      Alert.alert(
        'Error',
        'La contraseña debe tener al menos 6 caracteres.'
      );

      return false;
    }

    const {
      error,
      data,
    } =
      await supabase.auth.signUp(
        {
          email: cleanEmail,
          password,
          options: {
            data: {
              name: cleanName,
            },
          },
        }
      );

    if (error) {
      Alert.alert(
        'No se pudo crear la cuenta',
        traducirError(error.message)
      );

      return false;
    }

    if (!data.session) {
      Alert.alert(
        'Cuenta creada',
        'Revisa tu correo para confirmar la cuenta y después inicia sesión.'
      );
    }

    return true;
  };


  const signOut = async () => {
    const {
      error,
    } =
      await supabase.auth.signOut();

    if (error) {
      Alert.alert(
        'Error',
        'No se pudo cerrar la sesión.'
      );

      return;
    }

    setSession(null);
    setProfile(null);
  };


  if (loading) {
    return (
      <LoadingScreen
        text="Cargando El Chucho Apnea..."
      />
    );
  }


  if (
    !session ||
    !profile
  ) {
    return (
      <LoginScreen
        onLogin={signIn}
        onRegister={signUp}
      />
    );
  }


  if (
    profile.role ===
    'entrenador'
  ) {
    return (
      <TrainerScreen
        profile={profile}
        onLogout={signOut}
      />
    );
  }


  return (
    <StudentScreen
      profile={profile}
      onLogout={signOut}
      refreshProfile={() =>
        loadProfile(profile.id)
      }
      profileLoading={
        profileLoading
      }
    />
  );
}


/* =========================================================
   LOGIN
========================================================= */

function LoginScreen({
  onLogin,
  onRegister,
}) {
  const [mode, setMode] =
    useState('login');

  const [name, setName] =
    useState('');

  const [email, setEmail] =
    useState('');

  const [password, setPassword] =
    useState('');

  const [loading, setLoading] =
    useState(false);


  const submit = async () => {
    if (loading) return;

    setLoading(true);

    try {
      if (
        mode === 'login'
      ) {
        await onLogin(
          email,
          password
        );
      } else {
        const created =
          await onRegister(
            email,
            password,
            name
          );

        if (created) {
          setMode('login');
          setPassword('');
        }
      }
    } finally {
      setLoading(false);
    }
  };


  return (
    <SafeAreaView
      style={styles.container}
    >
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={
          Platform.OS === 'ios'
            ? 'padding'
            : undefined
        }
      >
        <ScrollView
          contentContainerStyle={
            styles.loginContainer
          }
          keyboardShouldPersistTaps="handled"
        >
          <View
            style={styles.loginCard}
          >
            <Text
              style={styles.logo}
            >
              🐕
            </Text>

            <Text
              style={styles.loginTitle}
            >
              El Chucho Apnea
            </Text>

            <Text
              style={styles.loginSubtitle}
            >
              Entrenamiento · Apnea · Progreso
            </Text>

            {mode ===
              'register' && (
              <>
                <Text
                  style={styles.inputLabel}
                >
                  Nombre
                </Text>

                <TextInput
                  style={styles.input}
                  placeholder="Tu nombre"
                  placeholderTextColor="#64748b"
                  value={name}
                  onChangeText={
                    setName
                  }
                  autoCapitalize="words"
                />
              </>
            )}

            <Text
              style={styles.inputLabel}
            >
              Email
            </Text>

            <TextInput
              style={styles.input}
              placeholder="tu@email.com"
              placeholderTextColor="#64748b"
              value={email}
              onChangeText={
                setEmail
              }
              keyboardType="email-address"
              autoCapitalize="none"
              autoCorrect={false}
            />

            <Text
              style={styles.inputLabel}
            >
              Contraseña
            </Text>

            <TextInput
              style={styles.input}
              placeholder="Mínimo 6 caracteres"
              placeholderTextColor="#64748b"
              value={password}
              onChangeText={
                setPassword
              }
              secureTextEntry
            />

            <TouchableOpacity
              style={[
                styles.primaryButton,
                loading &&
                  styles.disabledButton,
              ]}
              onPress={submit}
              disabled={loading}
            >
              {loading ? (
                <ActivityIndicator
                  color="#fff"
                />
              ) : (
                <Text
                  style={
                    styles.primaryButtonText
                  }
                >
                  {mode ===
                  'login'
                    ? 'Entrar'
                    : 'Crear cuenta'}
                </Text>
              )}
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.secondaryButton}
              onPress={() =>
                setMode(
                  mode ===
                    'login'
                    ? 'register'
                    : 'login'
                )
              }
            >
              <Text
                style={
                  styles.secondaryButtonText
                }
              >
                {mode === 'login'
                  ? 'Crear una cuenta'
                  : 'Ya tengo una cuenta'}
              </Text>
            </TouchableOpacity>

            {mode ===
              'register' && (
              <Text
                style={
                  styles.infoText
                }
              >
                Las cuentas nuevas se crean como
                Alumno. El rol de Entrenador lo
                asigna el administrador.
              </Text>
            )}
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}


/* =========================================================
   ALUMNO
========================================================= */

function StudentScreen({
  profile,
  onLogout,
  refreshProfile,
  profileLoading,
}) {
  const [sessions, setSessions] =
    useState([]);

  const [records, setRecords] =
    useState([]);

  const [loading, setLoading] =
    useState(true);

  const [refreshing, setRefreshing] =
    useState(false);

  const [staticMark, setStaticMark] =
    useState('');

  const [dynamicMark, setDynamicMark] =
    useState('');

  const loadData = useCallback(
    async () => {
      try {
        const [
          sessionsResult,
          recordsResult,
        ] =
          await Promise.all([
            supabase
              .from('sessions')
              .select(`
                id,
                title,
                session_date,
                max_slots,
                created_at,
                session_attendees (
                  student_id,
                  profiles (
                    id,
                    name
                  )
                )
              `)
              .order(
                'session_date',
                {
                  ascending: true,
                }
              ),

            supabase
              .from('apnea_records')
              .select('*')
              .eq(
                'student_id',
                profile.id
              )
              .order(
                'recorded_at',
                {
                  ascending: false,
                }
              ),
          ]);

        if (
          sessionsResult.error
        ) {
          console.log(
            sessionsResult.error
          );
        } else {
          setSessions(
            sessionsResult.data ||
              []
          );
        }

        if (
          recordsResult.error
        ) {
          console.log(
            recordsResult.error
          );
        } else {
          setRecords(
            recordsResult.data ||
              []
          );
        }
      } catch (error) {
        console.log(
          'Error cargando datos:',
          error
        );
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [profile.id]
  );


  useEffect(() => {
    loadData();

    const channel =
      supabase
        .channel(
          `student-${profile.id}`
        )
        .on(
          'postgres_changes',
          {
            event: '*',
            schema: 'public',
            table: 'sessions',
          },
          () => {
            loadData();
          }
        )
        .on(
          'postgres_changes',
          {
            event: '*',
            schema: 'public',
            table: 'session_attendees',
          },
          () => {
            loadData();
            refreshProfile();
          }
        )
        .on(
          'postgres_changes',
          {
            event: '*',
            schema: 'public',
            table: 'profiles',
          },
          () => {
            refreshProfile();
            loadData();
          }
        )
        .subscribe();

    return () => {
      supabase.removeChannel(
        channel
      );
    };
  }, [
    loadData,
    refreshProfile,
    profile.id,
  ]);


  const joinSession =
    async (sessionId) => {
      const {
        error,
      } =
        await supabase.rpc(
          'join_session',
          {
            p_session_id:
              sessionId,
          },
        );

      if (error) {
        const message =
          error.message || '';

        if (
          message.includes(
            'SIN_BONOS'
          )
        ) {
          Alert.alert(
            'Sin bonos',
            'No tienes bonos disponibles.'
          );
        } else if (
          message.includes(
            'SESION_LLENA'
          )
        ) {
          Alert.alert(
            'Sesión llena',
            'Ya no quedan plazas disponibles.'
          );
        } else if (
          message.includes(
            'YA_INSCRITO'
          )
        ) {
          Alert.alert(
            'Ya estás inscrito',
            'Ya estás apuntado a esta sesión.'
          );
        } else {
          Alert.alert(
            'Error',
            traducirError(
              message
            )
          );
        }

        return;
      }

      await Promise.all([
        refreshProfile(),
        loadData(),
      ]);

      Alert.alert(
        'Inscripción confirmada',
        'Te has apuntado correctamente y se ha descontado 1 bono.'
      );
    };


  const leaveSession =
    async (sessionId) => {
      Alert.alert(
        'Cancelar inscripción',
        '¿Quieres salir de esta sesión? Se te devolverá 1 bono.',
        [
          {
            text: 'No',
            style: 'cancel',
          },
          {
            text: 'Sí, cancelar',
            style: 'destructive',
            onPress:
              async () => {
                const {
                  error,
                } =
                  await supabase.rpc(
                    'leave_session',
                    {
                      p_session_id:
                        sessionId,
                    }
                  );

                if (error) {
                  Alert.alert(
                    'Error',
                    traducirError(
                      error.message
                    )
                  );

                  return;
                }

                await Promise.all([
                  refreshProfile(),
                  loadData(),
                ]);

                Alert.alert(
                  'Inscripción cancelada',
                  'Se te ha devuelto 1 bono.'
                );
              },
          },
        ]
      );
    };


  const saveRecord =
    async () => {
      const staticSeconds =
        parseStatic(
          staticMark
        );

      let dynamicMeters = null;

      if (
        dynamicMark.trim()
      ) {
        dynamicMeters =
          Number(
            dynamicMark
              .trim()
              .replace(',', '.')
          );

        if (
          !Number.isFinite(
            dynamicMeters
          ) ||
          dynamicMeters <= 0
        ) {
          Alert.alert(
            'Marca incorrecta',
            'Introduce una distancia válida en metros.'
          );

          return;
        }
      }

      if (
        !staticSeconds &&
        !dynamicMeters
      ) {
        Alert.alert(
          'Marca incorrecta',
          'Introduce al menos una marca.'
        );

        return;
      }

      if (
        staticMark.trim() &&
        !staticSeconds
      ) {
        Alert.alert(
          'Apnea estática incorrecta',
          'Usa, por ejemplo, 4:30.'
        );

        return;
      }

      const {
        error,
      } =
        await supabase
          .from('apnea_records')
          .insert({
            student_id:
              profile.id,

            static_seconds:
              staticSeconds,

            dynamic_meters:
              dynamicMeters,
          });

      if (error) {
        Alert.alert(
          'Error',
          'No se pudo guardar la marca.'
        );

        return;
      }

      setStaticMark('');
      setDynamicMark('');

      await loadData();

      Alert.alert(
        'Marca guardada',
        'Tu marca se ha registrado correctamente.'
      );
    };


  const onRefresh =
    async () => {
      setRefreshing(true);

      await Promise.all([
        loadData(),
        refreshProfile(),
      ]);

      setRefreshing(false);
    };


  if (loading) {
    return (
      <LoadingScreen
        text="Cargando tus entrenamientos..."
      />
    );
  }


  return (
    <SafeAreaView
      style={styles.container}
    >
      <View
        style={styles.header}
      >
        <View
          style={styles.headerInfo}
        >
          <Text
            style={styles.welcome}
          >
            Hola, {profile.name}
          </Text>

          <Text
            style={styles.bonusText}
          >
            🎟️ Bonos: {
              profile.bonuses
            }
          </Text>
        </View>

        <TouchableOpacity
          style={styles.logoutButton}
          onPress={onLogout}
        >
          <Text
            style={styles.logoutText}
          >
            Salir
          </Text>
        </TouchableOpacity>
      </View>


      <ScrollView
        contentContainerStyle={
          styles.scrollContent
        }
        refreshControl={
          <RefreshControl
            refreshing={
              refreshing ||
              profileLoading
            }
            onRefresh={onRefresh}
            tintColor="#38bdf8"
          />
        }
      >

        {/* MARCAS */}

        <SectionCard
          title="Mis marcas personales"
        >
          <Text
            style={styles.helpText}
          >
            Apnea estática en minutos:segundos.
            Dinámica en metros.
          </Text>

          <TextInput
            style={styles.input}
            placeholder="Estática — ejemplo: 4:30"
            placeholderTextColor="#64748b"
            value={staticMark}
            onChangeText={
              setStaticMark
            }
          />

          <TextInput
            style={styles.input}
            placeholder="Dinámica — ejemplo: 75"
            placeholderTextColor="#64748b"
            keyboardType="decimal-pad"
            value={dynamicMark}
            onChangeText={
              setDynamicMark
            }
          />

          <PrimaryButton
            title="Guardar marca"
            onPress={
              saveRecord
            }
          />

          {records.length ===
          0 ? (
            <Text
              style={styles.emptyText}
            >
              Todavía no tienes marcas registradas.
            </Text>
          ) : (
            records.map(
              (record) => (
                <View
                  key={record.id}
                  style={
                    styles.recordCard
                  }
                >
                  <Text
                    style={
                      styles.recordTitle
                    }
                  >
                    🫁 Marca
                  </Text>

                  <Text
                    style={
                      styles.recordValue
                    }
                  >
                    ⏱️ Estática:{' '}
                    {formatStatic(
                      record.static_seconds
                    )}
                  </Text>

                  <Text
                    style={
                      styles.recordValue
                    }
                  >
                    🌊 Dinámica:{' '}
                    {record.dynamic_meters
                      ? `${record.dynamic_meters} m`
                      : '—'}
                  </Text>

                  <Text
                    style={
                      styles.recordDate
                    }
                  >
                    {formatDate(
                      record.recorded_at
                    )}
                  </Text>
                </View>
              )
            )
          )}
        </SectionCard>


        {/* SESIONES */}

        <SectionCard
          title="Entrenamientos"
        >
          {sessions.length ===
          0 ? (
            <Text
              style={styles.emptyText}
            >
              No hay entrenamientos programados.
            </Text>
          ) : (
            sessions.map(
              (item) => {
                const attendees =
                  item.session_attendees ||
                  [];

                const isJoined =
                  attendees.some(
                    (attendee) =>
                      attendee.student_id ===
                      profile.id
                  );

                const isFull =
                  attendees.length >=
                  item.max_slots;

                return (
                  <View
                    key={item.id}
                    style={
                      styles.sessionCard
                    }
                  >
                    <Text
                      style={
                        styles.sessionTitle
                      }
                    >
                      {item.title}
                    </Text>

                    <Text
                      style={
                        styles.sessionDetail
                      }
                    >
                      📅{' '}
                      {formatDate(
                        item.session_date
                      )}
                    </Text>

                    <Text
                      style={
                        styles.sessionDetail
                      }
                    >
                      👥 Plazas:{' '}
                      {
                        attendees.length
                      } /{' '}
                      {
                        item.max_slots
                      }
                    </Text>

                    {isJoined ? (
                      <View>
                        <View
                          style={
                            styles.joinedBadge
                          }
                        >
                          <Text
                            style={
                              styles.joinedBadgeText
                            }
                          >
                            ✓ Estás apuntado
                          </Text>
                        </View>

                        <TouchableOpacity
                          style={
                            styles.cancelButton
                          }
                          onPress={() =>
                            leaveSession(
                              item.id
                            )
                          }
                        >
                          <Text
                            style={
                              styles.cancelButtonText
                            }
                          >
                            Cancelar inscripción
                          </Text>
                        </TouchableOpacity>
                      </View>
                    ) : (
                      <TouchableOpacity
                        style={[
                          styles.primaryButton,
                          (isFull ||
                            profile.bonuses <=
                              0) &&
                            styles.disabledButton,
                        ]}
                        disabled={
                          isFull ||
                          profile.bonuses <=
                            0
                        }
                        onPress={() =>
                          joinSession(
                            item.id
                          )
                        }
                      >
                        <Text
                          style={
                            styles.primaryButtonText
                          }
                        >
                          {isFull
                            ? 'Sesión llena'
                            : profile.bonuses <=
                              0
                            ? 'Sin bonos'
                            : 'Apuntarme — 1 bono'}
                        </Text>
                      </TouchableOpacity>
                    )}
                  </View>
                );
              }
            )
          )}
        </SectionCard>
      </ScrollView>
    </SafeAreaView>
  );
}


/* =========================================================
   ENTRENADOR
========================================================= */

function TrainerScreen({
  profile,
  onLogout,
}) {
  const [students, setStudents] =
    useState([]);

  const [sessions, setSessions] =
    useState([]);

  const [loading, setLoading] =
    useState(true);

  const [refreshing, setRefreshing] =
    useState(false);

  const [title, setTitle] =
    useState('');

  const [date, setDate] =
    useState('');

  const [time, setTime] =
    useState('20:00');

  const [maxSlots, setMaxSlots] =
    useState('4');

  const [creating, setCreating] =
    useState(false);


  const loadData = useCallback(
    async () => {
      try {
        const [
          studentsResult,
          sessionsResult,
        ] =
          await Promise.all([
            supabase
              .from('profiles')
              .select(
                'id,name,role,bonuses,created_at'
              )
              .eq(
                'role',
                'alumno'
              )
              .order('name'),

            supabase
              .from('sessions')
              .select(`
                id,
                title,
                session_date,
                max_slots,
                created_at,
                session_attendees (
                  student_id,
                  profiles (
                    id,
                    name
                  )
                )
              `)
              .order(
                'session_date',
                {
                  ascending: true,
                }
              ),
          ]);

        if (
          studentsResult.error
        ) {
          console.log(
            studentsResult.error
          );
        } else {
          setStudents(
            studentsResult.data ||
              []
          );
        }

        if (
          sessionsResult.error
        ) {
          console.log(
            sessionsResult.error
          );
        } else {
          setSessions(
            sessionsResult.data ||
              []
          );
        }
      } catch (error) {
        console.log(
          'Error entrenador:',
          error
        );
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    []
  );


  useEffect(() => {
    loadData();

    const channel =
      supabase
        .channel('trainer-live')
        .on(
          'postgres_changes',
          {
            event: '*',
            schema: 'public',
            table: 'profiles',
          },
          loadData
        )
        .on(
          'postgres_changes',
          {
            event: '*',
            schema: 'public',
            table: 'sessions',
          },
          loadData
        )
        .on(
          'postgres_changes',
          {
            event: '*',
            schema: 'public',
            table: 'session_attendees',
          },
          loadData
        )
        .subscribe();

    return () => {
      supabase.removeChannel(
        channel
      );
    };
  }, [loadData]);


  const createSession =
    async () => {
      if (creating) return;

      if (!title.trim()) {
        Alert.alert(
          'Error',
          'Introduce el título.'
        );

        return;
      }

      const sessionDate =
        parseDateTime(
          date,
          time
        );

      if (!sessionDate) {
        Alert.alert(
          'Fecha incorrecta',
          'Usa la fecha YYYY-MM-DD y la hora HH:MM.'
        );

        return;
      }

      const numericSlots =
        Number(maxSlots);

      if (
        !Number.isInteger(
          numericSlots
        ) ||
        numericSlots < 1 ||
        numericSlots > 100
      ) {
        Alert.alert(
          'Plazas incorrectas',
          'Introduce un número entre 1 y 100.'
        );

        return;
      }

      setCreating(true);

      try {
        const {
          data,
          error,
        } =
          await supabase
            .from('sessions')
            .insert({
              title:
                title.trim(),

              session_date:
                sessionDate,

              max_slots:
                numericSlots,

              created_by:
                profile.id,
            })
            .select()
            .single();

        if (error) {
          Alert.alert(
            'No se pudo crear',
            traducirError(
              error.message
            )
          );

          return;
        }

        setTitle('');
        setDate('');
        setTime('20:00');
        setMaxSlots('4');

        await loadData();

        Alert.alert(
          'Sesión publicada',
          'El entrenamiento se ha creado correctamente.'
        );

        /*
         * La notificación se manda desde
         * una Edge Function para no exponer
         * credenciales sensibles.
         */

        try {
          const {
            error:
              notificationError,
          } =
            await supabase.functions.invoke(
              'notify-new-session',
              {
                body: {
                  sessionId:
                    data.id,
                },
              }
            );

          if (
            notificationError
          ) {
            console.log(
              'No se pudo enviar el push:',
              notificationError
            );
          }
        } catch (
          notificationError
        ) {
          console.log(
            'Error push:',
            notificationError
          );
        }
      } finally {
        setCreating(false);
      }
    };


  const updateBonuses =
    async (
      studentId,
      delta
    ) => {
      const {
        error,
      } =
        await supabase.rpc(
          'update_student_bonuses',
          {
            p_student_id:
              studentId,

            p_delta:
              delta,
          }
        );

      if (error) {
        Alert.alert(
          'Error',
          traducirError(
            error.message
          )
        );

        return;
      }

      await loadData();
    };


  const deleteStudent =
    async (student) => {
      Alert.alert(
        'Eliminar alumno',
        `¿Seguro que quieres eliminar a ${student.name}? Se eliminarán sus marcas y sus inscripciones.`,
        [
          {
            text: 'Cancelar',
            style: 'cancel',
          },
          {
            text: 'Eliminar',
            style: 'destructive',
            onPress:
              async () => {
                const {
                  error,
                } =
                  await supabase.rpc(
                    'delete_student_profile',
                    {
                      p_student_id:
                        student.id,
                    }
                  );

                if (error) {
                  Alert.alert(
                    'Error',
                    traducirError(
                      error.message
                    )
                  );

                  return;
                }

                await loadData();

                Alert.alert(
                  'Alumno eliminado',
                  'El perfil, marcas e inscripciones del alumno han sido eliminados.'
                );
              },
          },
        ]
      );
    };


  const deleteSession =
    async (session) => {
      Alert.alert(
        'Eliminar sesión',
        `¿Quieres eliminar "${session.title}"?`,
        [
          {
            text: 'Cancelar',
            style: 'cancel',
          },
          {
            text: 'Eliminar',
            style: 'destructive',
            onPress:
              async () => {
                const {
                  error,
                } =
                  await supabase
                    .from(
                      'sessions'
                    )
                    .delete()
                    .eq(
                      'id',
                      session.id
                    );

                if (error) {
                  Alert.alert(
                    'Error',
                    traducirError(
                      error.message
                    )
                  );

                  return;
                }

                await loadData();
              },
          },
        ]
      );
    };


  const onRefresh =
    async () => {
      setRefreshing(true);
      await loadData();
      setRefreshing(false);
    };


  if (loading) {
    return (
      <LoadingScreen
        text="Cargando panel del entrenador..."
      />
    );
  }


  return (
    <SafeAreaView
      style={styles.container}
    >
      <View
        style={styles.header}
      >
        <View
          style={styles.headerInfo}
        >
          <Text
            style={styles.welcome}
          >
            Entrenador
          </Text>

          <Text
            style={styles.bonusText}
          >
            👋 {profile.name}
          </Text>
        </View>

        <TouchableOpacity
          style={styles.logoutButton}
          onPress={onLogout}
        >
          <Text
            style={styles.logoutText}
          >
            Salir
          </Text>
        </TouchableOpacity>
      </View>


      <ScrollView
        contentContainerStyle={
          styles.scrollContent
        }
        refreshControl={
          <RefreshControl
            refreshing={
              refreshing
            }
            onRefresh={
              onRefresh
            }
            tintColor="#38bdf8"
          />
        }
      >

        {/* CREAR SESIÓN */}

        <SectionCard
          title="Crear entrenamiento"
        >
          <TextInput
            style={styles.input}
            placeholder="Título"
            placeholderTextColor="#64748b"
            value={title}
            onChangeText={
              setTitle
            }
          />

          <TextInput
            style={styles.input}
            placeholder="Fecha — YYYY-MM-DD"
            placeholderTextColor="#64748b"
            value={date}
            onChangeText={
              setDate
            }
            keyboardType="numbers-and-punctuation"
          />

          <TextInput
            style={styles.input}
            placeholder="Hora — HH:MM"
            placeholderTextColor="#64748b"
            value={time}
            onChangeText={
              setTime
            }
            keyboardType="numbers-and-punctuation"
          />

          <TextInput
            style={styles.input}
            placeholder="Plazas máximas"
            placeholderTextColor="#64748b"
            value={maxSlots}
            onChangeText={
              setMaxSlots
            }
            keyboardType="number-pad"
          />

          <PrimaryButton
            title={
              creating
                ? 'Publicando...'
                : 'Publicar sesión'
            }
            onPress={
              createSession
            }
            disabled={
              creating
            }
          />
        </SectionCard>


        {/* ALUMNOS */}

        <SectionCard
          title={`Alumnos (${students.length})`}
        >
          {students.length ===
          0 ? (
            <Text
              style={styles.emptyText}
            >
              Todavía no hay alumnos registrados.
            </Text>
          ) : (
            students.map(
              (student) => (
                <View
                  key={
                    student.id
                  }
                  style={
                    styles.studentCard
                  }
                >
                  <View
                    style={
                      styles.studentInfo
                    }
                  >
                    <Text
                      style={
                        styles.studentName
                      }
                    >
                      {student.name}
                    </Text>

                    <Text
                      style={
                        styles.studentBonus
                      }
                    >
                      🎟️ {
                        student.bonuses
                      } bonos
                    </Text>
                  </View>

                  <View
                    style={
                      styles.studentActions
                    }
                  >
                    <TouchableOpacity
                      style={
                        styles.smallButton
                      }
                      onPress={() =>
                        updateBonuses(
                          student.id,
                          1
                        )
                      }
                    >
                      <Text
                        style={
                          styles.smallButtonText
                        }
                      >
                        +1
                      </Text>
                    </TouchableOpacity>

                    <TouchableOpacity
                      style={
                        styles.smallButton
                      }
                      onPress={() =>
                        updateBonuses(
                          student.id,
                          -1
                        )
                      }
                    >
                      <Text
                        style={
                          styles.smallButtonText
                        }
                      >
                        -1
                      </Text>
                    </TouchableOpacity>

                    <TouchableOpacity
                      style={
                        styles.deleteSmallButton
                      }
                      onPress={() =>
                        deleteStudent(
                          student
                        )
                      }
                    >
                      <Text
                        style={
                          styles.deleteSmallText
                        }
                      >
                        Borrar
                      </Text>
                    </TouchableOpacity>
                  </View>
                </View>
              )
            )
          )}
        </SectionCard>


        {/* SESIONES */}

        <SectionCard
          title="Sesiones programadas"
        >
          {sessions.length ===
          0 ? (
            <Text
              style={styles.emptyText}
            >
              No hay sesiones programadas.
            </Text>
          ) : (
            sessions.map(
              (item) => {
                const attendees =
                  item.session_attendees ||
                  [];

                return (
                  <View
                    key={item.id}
                    style={
                      styles.sessionCard
                    }
                  >
                    <View
                      style={
                        styles.sessionHeaderRow
                      }
                    >
                      <Text
                        style={
                          styles.sessionTitle
                        }
                      >
                        {item.title}
                      </Text>

                      <TouchableOpacity
                        style={
                          styles.deleteSessionButton
                        }
                        onPress={() =>
                          deleteSession(
                            item
                          )
                        }
                      >
                        <Text
                          style={
                            styles.deleteSessionText
                          }
                        >
                          Eliminar
                        </Text>
                      </TouchableOpacity>
                    </View>

                    <Text
                      style={
                        styles.sessionDetail
                      }
                    >
                      📅{' '}
                      {formatDate(
                        item.session_date
                      )}
                    </Text>

                    <Text
                      style={
                        styles.sessionDetail
                      }
                    >
                      👥{' '}
                      {
                        attendees.length
                      } /{' '}
                      {
                        item.max_slots
                      } plazas
                    </Text>

                    <Text
                      style={
                        styles.attendeesTitle
                      }
                    >
                      Alumnos inscritos
                    </Text>

                    {attendees.length ===
                    0 ? (
                      <Text
                        style={
                          styles.emptyText
                        }
                      >
                        Ninguno todavía.
                      </Text>
                    ) : (
                      attendees.map(
                        (
                          attendee
                        ) => (
                          <Text
                            key={
                              attendee.student_id
                            }
                            style={
                              styles.attendeeName
                            }
                          >
                            •{' '}
                            {
                              attendee
                                .profiles
                                ?.name
                            }
                          </Text>
                        )
                      )
                    )}
                  </View>
                );
              }
            )
          )}
        </SectionCard>
      </ScrollView>
    </SafeAreaView>
  );
}


/* =========================================================
   COMPONENTES UI
========================================================= */

function LoadingScreen({
  text,
}) {
  return (
    <SafeAreaView
      style={styles.container}
    >
      <View
        style={styles.center}
      >
        <ActivityIndicator
          size="large"
          color="#38bdf8"
        />

        <Text
          style={styles.loadingText}
        >
          {text}
        </Text>
      </View>
    </SafeAreaView>
  );
}


function SectionCard({
  title,
  children,
}) {
  return (
    <View
      style={styles.sectionCard}
    >
      <Text
        style={styles.sectionTitle}
      >
        {title}
      </Text>

      {children}
    </View>
  );
}


function PrimaryButton({
  title,
  onPress,
  disabled = false,
}) {
  return (
    <TouchableOpacity
      style={[
        styles.primaryButton,
        disabled &&
          styles.disabledButton,
      ]}
      onPress={onPress}
      disabled={disabled}
    >
      <Text
        style={
          styles.primaryButtonText
        }
      >
        {title}
      </Text>
    </TouchableOpacity>
  );
}


/* =========================================================
   ERRORES
========================================================= */

function traducirError(
  message
) {
  if (!message) {
    return 'Ha ocurrido un error.';
  }

  const value =
    message.toLowerCase();

  if (
    value.includes(
      'invalid login credentials'
    )
  ) {
    return 'Email o contraseña incorrectos.';
  }

  if (
    value.includes(
      'email not confirmed'
    )
  ) {
    return 'Debes confirmar tu email antes de iniciar sesión.';
  }

  if (
    value.includes(
      'user already registered'
    )
  ) {
    return 'Este email ya está registrado.';
  }

  if (
    value.includes(
      'password should be at least'
    )
  ) {
    return 'La contraseña es demasiado corta.';
  }

  if (
    value.includes(
      'duplicate'
    )
  ) {
    return 'Ya existe un registro con esos datos.';
  }

  if (
    value.includes(
      'no autorizado'
    ) ||
    value.includes(
      'no_autorizado'
    )
  ) {
    return 'No tienes permisos para realizar esta acción.';
  }

  return message;
}


/* =========================================================
   ESTILOS
========================================================= */

const styles =
  StyleSheet.create({

    flex: {
      flex: 1,
    },

    container: {
      flex: 1,
      backgroundColor:
        '#070b14',
    },

    center: {
      flex: 1,
      alignItems:
        'center',
      justifyContent:
        'center',
      padding: 24,
    },

    loadingText: {
      color:
        '#94a3b8',
      marginTop: 14,
      fontSize: 15,
      textAlign:
        'center',
    },

    loginContainer: {
      flexGrow: 1,
      justifyContent:
        'center',
      padding: 20,
    },

    loginCard: {
      backgroundColor:
        '#111827',
      borderRadius: 20,
      padding: 24,
      borderWidth: 1,
      borderColor:
        '#1e293b',
      width: '100%',
      maxWidth: 480,
      alignSelf:
        'center',
    },

    logo: {
      fontSize: 54,
      textAlign:
        'center',
      marginBottom: 6,
    },

    loginTitle: {
      color:
        '#f8fafc',
      fontSize: 28,
      fontWeight:
        '800',
      textAlign:
        'center',
    },

    loginSubtitle: {
      color:
        '#94a3b8',
      fontSize: 14,
      textAlign:
        'center',
      marginTop: 6,
      marginBottom: 26,
    },

    inputLabel: {
      color:
        '#cbd5e1',
      fontSize: 13,
      fontWeight:
        '600',
      marginBottom: 6,
    },

    input: {
      backgroundColor:
        '#0b1220',
      borderWidth: 1,
      borderColor:
        '#263449',
      color:
        '#f8fafc',
      borderRadius: 10,
      paddingHorizontal: 14,
      paddingVertical: 13,
      marginBottom: 12,
      fontSize: 15,
    },

    primaryButton: {
      backgroundColor:
        '#0284c7',
      paddingVertical: 13,
      paddingHorizontal: 16,
      borderRadius: 10,
      alignItems:
        'center',
      justifyContent:
        'center',
      marginTop: 4,
      marginBottom: 8,
      minHeight: 46,
    },

    primaryButtonText: {
      color:
        '#ffffff',
      fontSize: 15,
      fontWeight:
        '800',
    },

    secondaryButton: {
      paddingVertical: 12,
      alignItems:
        'center',
    },

    secondaryButtonText: {
      color:
        '#38bdf8',
      fontWeight:
        '700',
    },

    infoText: {
      color:
        '#64748b',
      fontSize: 12,
      lineHeight: 18,
      textAlign:
        'center',
      marginTop: 12,
    },

    disabledButton: {
      opacity: 0.45,
    },

    header: {
      backgroundColor:
        '#111827',
      borderBottomWidth: 1,
      borderBottomColor:
        '#1e293b',
      paddingHorizontal: 18,
      paddingVertical: 14,
      flexDirection:
        'row',
      justifyContent:
        'space-between',
      alignItems:
        'center',
    },

    headerInfo: {
      flex: 1,
    },

    welcome: {
      color:
        '#f8fafc',
      fontSize: 19,
      fontWeight:
        '800',
    },

    bonusText: {
      color:
        '#38bdf8',
      fontSize: 13,
      marginTop: 3,
    },

    logoutButton: {
      backgroundColor:
        '#3f1d26',
      borderRadius: 8,
      paddingHorizontal: 12,
      paddingVertical: 9,
    },

    logoutText: {
      color:
        '#fda4af',
      fontWeight:
        '700',
      fontSize: 12,
    },

    scrollContent: {
      padding: 14,
      paddingBottom: 40,
    },

    sectionCard: {
      backgroundColor:
        '#111827',
      borderRadius: 14,
      borderWidth: 1,
      borderColor:
        '#1e293b',
      padding: 16,
      marginBottom: 14,
    },

    sectionTitle: {
      color:
        '#f8fafc',
      fontSize: 19,
      fontWeight:
        '800',
      marginBottom: 14,
    },

    helpText: {
      color:
        '#64748b',
      fontSize: 12,
      lineHeight: 18,
      marginBottom: 12,
    },

    emptyText: {
      color:
        '#64748b',
      fontSize: 13,
      fontStyle:
        'italic',
      marginTop: 4,
    },

    recordCard: {
      backgroundColor:
        '#0b1220',
      borderRadius: 10,
      borderWidth: 1,
      borderColor:
        '#1e293b',
      padding: 12,
      marginTop: 9,
    },

    recordTitle: {
      color:
        '#f8fafc',
      fontWeight:
        '800',
      marginBottom: 6,
    },

    recordValue: {
      color:
        '#cbd5e1',
      fontSize: 14,
      marginTop: 3,
    },

    recordDate: {
      color:
        '#64748b',
      fontSize: 11,
      marginTop: 8,
    },

    sessionCard: {
      backgroundColor:
        '#0b1220',
      borderRadius: 12,
      borderWidth: 1,
      borderColor:
        '#1e293b',
      padding: 13,
      marginBottom: 10,
    },

    sessionHeaderRow: {
      flexDirection:
        'row',
      alignItems:
        'flex-start',
      justifyContent:
        'space-between',
      gap: 10,
    },

    sessionTitle: {
      color:
        '#f8fafc',
      fontSize: 16,
      fontWeight:
        '800',
      flex: 1,
    },

    sessionDetail: {
      color:
        '#94a3b8',
      fontSize: 13,
      marginTop: 5,
    },

    joinedBadge: {
      backgroundColor:
        '#064e3b',
      borderRadius: 8,
      padding: 9,
      marginTop: 10,
    },

    joinedBadgeText: {
      color:
        '#6ee7b7',
      fontWeight:
        '800',
      textAlign:
        'center',
    },

    cancelButton: {
      backgroundColor:
        '#334155',
      borderRadius: 9,
      paddingVertical: 11,
      alignItems:
        'center',
      marginTop: 8,
    },

    cancelButtonText: {
      color:
        '#f8fafc',
      fontWeight:
        '700',
    },

    studentCard: {
      backgroundColor:
        '#0b1220',
      borderRadius: 10,
      borderWidth: 1,
      borderColor:
        '#1e293b',
      padding: 11,
      marginBottom: 9,
    },

    studentInfo: {
      marginBottom: 9,
    },

    studentName: {
      color:
        '#f8fafc',
      fontSize: 16,
      fontWeight:
        '800',
    },

    studentBonus: {
      color:
        '#38bdf8',
      marginTop: 3,
      fontSize: 13,
    },

    studentActions: {
      flexDirection:
        'row',
      gap: 7,
    },

    smallButton: {
      backgroundColor:
        '#1e3a5f',
      borderRadius: 7,
      paddingHorizontal: 14,
      paddingVertical: 8,
    },

    smallButtonText: {
      color:
        '#bae6fd',
      fontWeight:
        '800',
    },

    deleteSmallButton: {
      backgroundColor:
        '#4c1d1d',
      borderRadius: 7,
      paddingHorizontal: 12,
      paddingVertical: 8,
      marginLeft:
        'auto',
    },

    deleteSmallText: {
      color:
        '#fca5a5',
      fontWeight:
        '800',
    },

    deleteSessionButton: {
      backgroundColor:
        '#4c1d1d',
      borderRadius: 7,
      paddingHorizontal: 9,
      paddingVertical: 6,
    },

    deleteSessionText: {
      color:
        '#fca5a5',
      fontSize: 11,
      fontWeight:
        '800',
    },

    attendeesTitle: {
      color:
        '#f8fafc',
      fontWeight:
        '800',
      marginTop: 13,
      marginBottom: 5,
    },

    attendeeName: {
      color:
        '#cbd5e1',
      fontSize: 13,
      marginTop: 4,
    },

  });
